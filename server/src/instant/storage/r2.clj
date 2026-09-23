(ns instant.storage.r2
  "Cloudflare R2 storage provider.

   R2 exposes an S3-compatible API at:
     https://<account-id>.r2.cloudflarestorage.com

   This implementation reuses the existing S3 utilities (s3-util) and the
   generic object-key scheme (app-id/bin/location-id) so that:
   * uploads, downloads, and deletes behave identically to S3
   * the coordinator remains fully provider-neutral
   * public URLs are constructed from a configurable public base URL
     (R2 itself does not expose a `secure_url`-equivalent; bucket access
     is via custom domain, r2.dev subdomain, or worker route)

   Configuration is per-app and lives in app_storage_configs (see
   instant.model.app-storage-config). The global configuration path is
   used when no per-app config exists."
  (:require
   [clojure.string :as string]
   [instant.config :as config]
   [instant.storage.s3 :as instant-s3]
   [instant.util.s3 :as s3-util]
   [instant.util.tracer :as tracer])
  (:import
   (java.io InputStream)
   (java.net URI)
   (java.time Duration)
   (software.amazon.awssdk.auth.credentials AwsBasicCredentials StaticCredentialsProvider)
   (software.amazon.awssdk.regions Region)
   (software.amazon.awssdk.services.s3 S3Client S3ClientBuilder)
   (software.amazon.awssdk.services.s3.model S3Exception)))

(set! *warn-on-reflection* true)

;; ---------------------------------------------------------------
;; Configuration
;; ---------------------------------------------------------------

(defn- r2-config-from-ctx
  "Extract R2 configuration from a request ctx.
   Order: per-app config (passed via ctx) > global env vars.
   Throws :r2/missing-config if neither is set."
  [{:keys [r2-account-id r2-access-key-id r2-secret-access-key
           r2-bucket-name r2-endpoint r2-public-base-url]}]
  (let [account-id       (or r2-account-id       (config/r2-account-id))
        access-key-id    (or r2-access-key-id    (config/r2-access-key-id))
        secret-access-key (or r2-secret-access-key (config/r2-secret-access-key))
        bucket-name      (or r2-bucket-name      (config/r2-bucket-name))
        endpoint         (or r2-endpoint
                             (when account-id
                               (str "https://" account-id ".r2.cloudflarestorage.com")))
        public-base-url  (or r2-public-base-url  (config/r2-public-base-url))]
    (cond
      (string/blank? account-id)
      (throw (ex-info "R2 account id is required (R2_ACCOUNT_ID)"
                      {:type :r2/missing-config :missing :account-id}))

      (string/blank? access-key-id)
      (throw (ex-info "R2 access key id is required (R2_ACCESS_KEY_ID)"
                      {:type :r2/missing-config :missing :access-key-id}))

      (string/blank? secret-access-key)
      (throw (ex-info "R2 secret access key is required (R2_SECRET_ACCESS_KEY)"
                      {:type :r2/missing-config :missing :secret-access-key}))

      (string/blank? bucket-name)
      (throw (ex-info "R2 bucket name is required (R2_BUCKET)"
                      {:type :r2/missing-config :missing :bucket-name}))

      (string/blank? endpoint)
      (throw (ex-info "R2 endpoint could not be derived (set R2_ENDPOINT or R2_ACCOUNT_ID)"
                      {:type :r2/missing-config :missing :endpoint}))

      :else
      {:account-id account-id
       :access-key-id access-key-id
       :secret-access-key secret-access-key
       :bucket-name bucket-name
       :endpoint endpoint
       :public-base-url public-base-url})))

;; ---------------------------------------------------------------
;; S3-compatible client (reused per-config)
;; ---------------------------------------------------------------

(def ^:private clients (atom {}))

(defn- client-for
  "Build (or fetch cached) S3-compatible client for an R2 config."
  ^S3Client [cfg]
  (let [{:keys [access-key-id secret-access-key endpoint]} cfg
        cache-key (str endpoint "|" access-key-id)]
    (if-let [cached (get @clients cache-key)]
      cached
      (let [^S3ClientBuilder builder (-> (S3Client/builder)
                                         (.endpointOverride (URI/create endpoint))
                                         (.region (Region/of "auto"))
                                         (.forcePathStyle Boolean/TRUE)
                                         (.credentialsProvider
                                          (StaticCredentialsProvider/create
                                           (AwsBasicCredentials/create access-key-id
                                                                       secret-access-key))))]
        (let [client (.build builder)]
          (swap! clients assoc cache-key client)
          client)))))

;; ---------------------------------------------------------------
;; Public URL construction
;; ---------------------------------------------------------------

(defn public-url
  "Build the public URL for a stored object. Uses the configured
   public base URL (custom domain, r2.dev subdomain, or worker route).
   If no public base URL is configured, throws :r2/no-public-url so
   callers can fall back to a signed download URL."
  [cfg object-key]
  (let [base (:public-base-url cfg)]
    (when (string/blank? base)
      (throw (ex-info "R2 has no public base URL configured. Set R2_PUBLIC_BASE_URL "
                      "(e.g. https://files.example.com) or use a signed URL."
                      {:type :r2/no-public-url})))
    (str (string/replace base #"/$" "") "/" object-key)))

(defn signed-download-url
  "Generate a presigned GET URL valid for `duration` (default 7 days).
   Reuses the existing S3 presign machinery."
  ([cfg object-key] (signed-download-url cfg object-key (Duration/ofDays 7)))
  ([cfg object-key ^Duration duration]
   (s3-util/generate-presigned-url
    {:access-key (:access-key-id cfg)
     :secret-key (:secret-access-key cfg)
     :region "auto"}
    {:app-id (:app-id cfg)
     :method :get
     :bucket-name (:bucket-name cfg)
     :key object-key
     :duration duration})))

(defn signed-upload-url
  "Generate a presigned PUT URL valid for `duration` (default 15 min).
   Clients upload directly to R2 without going through the Instant server."
  ([cfg object-key] (signed-upload-url cfg object-key (Duration/ofMinutes 15)))
  ([cfg object-key ^Duration duration]
   (s3-util/generate-presigned-url
    {:access-key (:access-key-id cfg)
     :secret-key (:secret-access-key cfg)
     :region "auto"}
    {:app-id (:app-id cfg)
     :method :put
     :bucket-name (:bucket-name cfg)
     :key object-key
     :duration duration})))

;; ---------------------------------------------------------------
;; Object-key strategy (identical to S3)
;; ---------------------------------------------------------------

(defn ->object-key [app-id location-id]
  (instant-s3/->object-key app-id location-id))

;; ---------------------------------------------------------------
;; Upload / metadata / delete
;; ---------------------------------------------------------------

(defn upload-file!
  "Upload a file to R2 and return a normalized provider result:
     {:location :size :content-type :provider-data}

   The generic coordinator and `$files` only ever see :location/:size/:content-type.
   Anything Cloudinary/R2-specific goes into :provider-data.

   Reuses the existing S3 transfer path via s3-util/upload-stream-to-s3.
   R2 size is read from the resulting object's HEAD."
  [{:keys [app-id location-id content-type] :as ctx} file_]
  (when (not (instance? InputStream file_))
    (throw (ex-info "Unsupported file format" {:type :storage/unsupported-file})))
  (let [cfg (r2-config-from-ctx ctx)
        object-key (->object-key app-id location-id)
        content-type (or content-type "application/octet-stream")
        client (client-for cfg)]
    (tracer/with-span! {:name "upload-file-to-r2"
                        :attributes {:app-id app-id
                                     :location-id location-id
                                     :bucket (:bucket-name cfg)
                                     :endpoint (:endpoint cfg)
                                     :content-type content-type}}
      (try
        ;; Upload via the shared S3-compatible transfer manager
        (s3-util/upload-stream-to-s3
         client (:bucket-name cfg)
         (assoc ctx :object-key object-key)
         file_)
        ;; Read back authoritative size via HEAD
        (let [head (s3-util/head-object client (:bucket-name cfg) object-key)
              size (:content-length head)]
          (when (nil? size)
            (throw (ex-info "R2 returned no size after upload"
                            {:type :storage/missing-metadata
                             :provider :r2
                             :object-key object-key})))
          {:location object-key
           :size size
           :content-type (:content-type head)
           :content-disposition (:content-disposition head)
           :provider-data {:r2/account-id (:account-id cfg)
                           :r2/bucket (:bucket-name cfg)
                           :r2/endpoint (:endpoint cfg)
                           :r2/public-base-url (:public-base-url cfg)
                           :r2/etag (:etag head)}})
        (catch S3Exception e
          (tracer/add-data! {:attributes {:r2-upload-status (.statusCode e)
                                          :r2-upload-error (.awsErrorDetails e)}})
          (throw (ex-info (str "R2 upload failed: " (.awsErrorDetails e))
                          {:type :storage/provider-failure
                           :provider :r2
                           :status (.statusCode e)
                           :object-key object-key})))))))

(defn get-object-metadata [cfg app-id location-id]
  (let [object-key (->object-key app-id location-id)
        client (client-for cfg)]
    (try
      (let [head (s3-util/head-object client (:bucket-name cfg) object-key)
            size (:content-length head)]
        (when (nil? size)
          (throw (ex-info "R2 returned no size for existing object"
                          {:type :storage/missing-metadata :provider :r2})))
        {:size size
         :content-type (:content-type head)
         :content-disposition (:content-disposition head)
         :url (or (try (public-url cfg object-key) (catch Throwable _ nil))
                  (signed-download-url cfg object-key))})
      (catch S3Exception e
        (tracer/add-data! {:attributes {:r2-head-status (.statusCode e)}})
        (throw (ex-info (str "R2 HEAD failed: " (.awsErrorDetails e))
                        {:type :storage/provider-failure
                         :provider :r2
                         :status (.statusCode e)}))))))

(defn delete-file! [cfg app-id location-id]
  (when location-id
    (let [object-key (->object-key app-id location-id)
          client (client-for cfg)]
      (try
        (s3-util/delete-object client (:bucket-name cfg) object-key)
        (catch S3Exception e
          (tracer/add-data! {:attributes {:r2-delete-status (.statusCode e)}})
          (throw (ex-info (str "R2 DELETE failed: " (.awsErrorDetails e))
                          {:type :storage/provider-failure
                           :provider :r2
                           :status (.statusCode e)})))))))

(defn location-id-url [cfg app-id location-id]
  (let [object-key (->object-key app-id location-id)]
    ;; Prefer a public URL when configured; otherwise return a signed URL.
    (or (try (public-url cfg object-key) (catch Throwable _ nil))
        (signed-download-url cfg object-key))))

(defn bulk-delete-files! [cfg app-id location-ids]
  (let [object-keys (mapv #(->object-key app-id %) location-ids)
        client (client-for cfg)]
    (try
      (s3-util/delete-objects-paginated client (:bucket-name cfg) object-keys)
      (catch S3Exception e
        (tracer/add-data! {:attributes {:r2-bulk-delete-status (.statusCode e)}})
        (throw (ex-info (str "R2 bulk DELETE failed: " (.awsErrorDetails e))
                        {:type :storage/provider-failure
                         :provider :r2
                         :status (.statusCode e)}))))))

;; ---------------------------------------------------------------
;; Coordinator-facing helpers
;; ---------------------------------------------------------------

(defn ctx->config
  "Resolve R2 config from a request context. Used by the coordinator."
  [ctx]
  (r2-config-from-ctx ctx))
