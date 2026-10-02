(ns instant.storage.coordinator
  (:require [instant.flags :as flags]
            [instant.storage.s3 :as instant-s3]
            [instant.storage.cloudinary :as instant-cloudinary]
            [instant.storage.provider :as storage-provider]
            [instant.model.app-file :as app-file-model]
            [instant.model.app-storage-config :as app-storage-config]
            [instant.model.rule :as rule-model]
            [instant.storage.beta :as storage-beta]
            [instant.util.exception :as ex]
            [instant.util.tracer :as tracer]
            [instant.db.model.attr :as attr-model]
            [instant.db.datalog :as d]
            [instant.db.cel :as cel]
            [instant.jdbc.aurora :as aurora]
            [instant.model.app-upload-url :as app-upload-url-model]
            [instant.config :as config]
            [instant.util.string :as string-util])
  (:import
    (java.time Instant)
    (java.util Date)))

(defn assert-storage-permission! [action {:keys [app-id
                                                 path
                                                 rules-override]
                                          :as ctx}]
  (let [rules (if rules-override
                rules-override
                (rule-model/get-by-app-id {:app-id app-id}))
        program (rule-model/get-program! rules "$files" action)]
    (ex/assert-permitted!
     :has-storage-permission?
     ["$files" action]
     ;; deny access by default if no permissions are currently set
     (if-not program
       false
       (let [ctx* (assoc ctx
                         :db {:conn-pool (aurora/conn-pool :read)}
                         :attrs
                         (attr-model/get-by-app-id app-id)
                         :datalog-query-fn d/query)]
         (cel/eval-program! ctx* program {:data {"path" path}}))))))

(defn get-storage-config [app-id]
  "Get storage config for an app, returns nil if none configured (uses global defaults)"
  (when-let [config (app-storage-config/get-by-app-id {:app-id app-id})]
    (when (= true (:is_active config))
      config)))

(defn upload-with-config
  "Upload file using per-app storage config if available, otherwise global config.
   Returns a normalized provider result: {:location :size :content-type :provider-data}.
   Provider-specific keys (e.g. :bytes, :secure-url, :public-id) MUST NOT be returned.
   The provider is responsible for normalization; the coordinator only sees generic fields."
  [{:keys [app-id location-id content-type] :as ctx} file]
  (if-let [app-config (get-storage-config app-id)]
    (let [provider-type (or (:provider_type app-config) "cloudinary")
          provider-kw (case provider-type
                        "cloudinary" :cloudinary
                        "r2" :r2
                        "s3" :s3
                        :cloudinary)
          ctx-with-config (cond-> (assoc ctx
                                        :location-id location-id
                                        :storage-provider provider-kw)
                            ;; Cloudinary
                            (:cloud_name app-config) (assoc :cloud-name (:cloud_name app-config))
                            (:api_key app-config) (assoc :api-key (:api_key app-config))
                            (:api_secret app-config) (assoc :api-secret (:api_secret app-config))
                            (:upload_preset app-config) (assoc :upload-preset (:upload_preset app-config))
                            ;; R2 / S3
                            (:account_id app-config) (assoc :r2-account-id (:account_id app-config))
                            (:access_key_id app-config) (assoc :r2-access-key-id (:access_key_id app-config))
                            (:secret_access_key app-config) (assoc :r2-secret-access-key (:secret_access_key app-config))
                            (:bucket_name app-config) (assoc :r2-bucket-name (:bucket_name app-config))
                            (:endpoint app-config) (assoc :r2-endpoint (:endpoint app-config))
                            (:public_base_url app-config) (assoc :r2-public-base-url (:public_base_url app-config)))]
      (storage-provider/upload-file! ctx-with-config file))
    (storage-provider/upload-file! (assoc ctx :location-id location-id) file)))

;; TODO(dww): open up create/update capability for the client sdks,
;;            but need to clean up if the create fails
(defn upload-file!
  "Uploads a file to the configured storage provider and tracks it in Instant.
   Returns a map with file id, location-id, size, content-type, path, and public url."
  [{:keys [app-id path current-user mode skip-perms-check?] :as ctx}
   file]
  (storage-beta/assert-storage-enabled! app-id)
  (when (not skip-perms-check?)
    (assert-storage-permission! "create" {:app-id app-id
                                           :path path
                                           :current-user current-user}))
  (let [location-id (str (random-uuid))
        ctx-with-location (assoc ctx :location-id location-id)
        upload-result (upload-with-config ctx-with-location file)
        _ (when-let [copy-bucket (flags/copy-file-bucket app-id)]
            (try
              (instant-s3/copy-file {:destination-bucket copy-bucket
                                     :app-id app-id
                                     :location-id location-id
                                     :access-key (config/s3-storage-access-key)
                                     :secret-key (config/s3-storage-secret-key)})
              (catch Throwable e
                ;; The source object is uploaded but we bail before creating a
                ;; file record, so delete it (best-effort) to avoid orphaning
                ;; it in S3, then surface the original copy error.
                (try
                  (storage-provider/delete-file! ctx app-id location-id)
                  (catch Throwable _ nil))
                (throw e))))
        ;; Coordinator consumes ONLY normalized provider result fields.
        ;; Never reads provider-specific keys (e.g. :bytes, :secure-url).
        ;; If the provider returned a result, it MUST be a normalized map with
        ;; at least :size and :content-type. If either is missing, we fail hard
        ;; rather than creating an invalid `$files` record.
        _ (tracer/add-data! {:attributes {:trace-step "metadata-extraction"
                                          :upload-result-truthy (boolean upload-result)
                                          :upload-result-is-map (when upload-result (map? upload-result))
                                          :result-has-size (when upload-result (contains? upload-result :size))
                                          :result-has-content-type (when upload-result (contains? upload-result :content-type))
                                          :result-has-location (when upload-result (contains? upload-result :location))}})
        metadata (if (and upload-result (map? upload-result))
                   (do
                     (when (nil? (:size upload-result))
                       (throw (ex-info "Storage provider returned no :size — refusing to create $files record with missing size"
                                       {:type :storage/missing-metadata
                                        :provider-result-keys (keys upload-result)})))
                     {:content-type (:content-type upload-result)
                      :size (:size upload-result)
                      :content-disposition (:content-disposition upload-result)})
                   (let [fallback (storage-provider/get-object-metadata ctx app-id location-id)]
                     (when (or (nil? (:size fallback)) (nil? (:content-type fallback)))
                       (throw (ex-info "Storage provider metadata incomplete — refusing to create $files record"
                                       {:type :storage/missing-metadata
                                        :fallback-keys (keys fallback)})))
                     {:content-type (:content-type fallback)
                      :size (:size fallback)
                      :content-disposition (:content-disposition fallback)}))]
    (try
      (let [file-record (app-file-model/create!
                         {:app-id app-id
                          :path path
                          :location-id location-id
                          :metadata metadata
                          :mode mode})
            ;; Generate the public URL for the uploaded file. Pass the
            ;; content-type so the provider can build the correct
            ;; resource-type (image/video/raw) segment in the URL.
            ;; Without this, Cloudinary defaults to "raw" which 404s for
            ;; videos and renders wrong thumbnails for images.
            public-url (storage-provider/location-id-url
                        ctx-with-location
                        app-id
                        location-id
                        (:content-type metadata))]
        ;; Return complete file info including the public URL
        {:id (:id file-record)
         :location-id location-id
         :path path
         :size (:size file-record)
         :content-type (:content-type metadata)
         :url public-url})
      (catch clojure.lang.ExceptionInfo e
        (throw (ex-info (.getMessage e)
                        (assoc (ex-data e)
                               ::upload-meta {:location-id location-id
                                              :metadata metadata})
                        (ex-cause e)))))))

(defn delete-files!
  "Deletes multiple files from Instant and the underlying storage provider.
   Handles both modern ($files entity) and legacy (app_upload_urls) upload flows."
  [{:keys [app-id paths current-user skip-perms-check?]}]
  (storage-beta/assert-storage-enabled! app-id)
  (when (not skip-perms-check?)
    (doseq [path paths]
      (assert-storage-permission! "delete" {:app-id app-id
                                            :path path
                                            :current-user current-user})))
  (let [app-config (get-storage-config app-id)
        provider-type (or (some-> app-config :provider_type) (config/storage-provider))
        provider-kw (keyword provider-type)
        ;; Build config for the provider
        provider-config {:storage-provider provider-kw
                         :cloud-name (or (some-> app-config :cloud_name)
                                        (config/cloudinary-cloud-name))
                         :api-key (or (some-> app-config :api_key)
                                      (config/cloudinary-api-key))
                         :api-secret (or (some-> app-config :api_secret)
                                        (config/cloudinary-api-secret))}]
    ;; Get files from $files entity
    (let [files (map #(app-file-model/get-by-path {:app-id app-id :path %}) paths)
          location-ids (map :location-id files)]
      ;; Delete from storage provider (Cloudinary, S3, R2, etc.)
      (when (seq location-ids)
        (storage-provider/bulk-delete-files! provider-config app-id location-ids))
      ;; Delete from database ($files entity)
      (let [deleted (app-file-model/delete-by-paths! {:app-id app-id :paths paths})]
        {:ids (mapv :id deleted)}))))

(defn delete-file!
  "Deletes a file from Instant and the underlying storage provider.
   Handles both modern ($files entity) and legacy (app_upload_urls) upload flows."
  [{:keys [app-id path current-user skip-perms-check?]}]
  (when (not skip-perms-check?)
    (assert-storage-permission! "delete" {:app-id app-id
                                          :path path
                                          :current-user current-user}))
  (let [app-config (get-storage-config app-id)
        provider-type (or (some-> app-config :provider_type) (config/storage-provider))
        provider-kw (keyword provider-type)
        ;; Build config for the provider
        provider-config {:storage-provider provider-kw
                         :cloud-name (or (some-> app-config :cloud_name)
                                        (config/cloudinary-cloud-name))
                         :api-key (or (some-> app-config :api_key)
                                      (config/cloudinary-api-key))
                         :api-secret (or (some-> app-config :api_secret)
                                        (config/cloudinary-api-secret))}]
    ;; First try the modern $files entity lookup
    (if-let [file (app-file-model/get-by-path {:app-id app-id :path path})]
      (do
        ;; Delete from storage provider (Cloudinary, S3, R2, etc.)
        (storage-provider/delete-file! provider-config app-id (:location-id file) (:content-type file))
        ;; Delete from database
        (let [{:keys [id]} (app-file-model/delete-by-path! {:app-id app-id :path path})]
          {:id id}))
      ;; Fallback: check legacy app_upload_urls table
      (let [legacy-record (first (filter #(= path (:path %))
                                         (app-upload-url-model/list-by-app-id {:app-id app-id})))]
        ;; If found in legacy table, attempt Cloudinary deletion
        (when legacy-record
          (try
            (storage-provider/delete-file! provider-config app-id (:path legacy-record) nil)
            (catch Throwable _ nil)))
        ;; Note: app_upload_urls records are consumed (deleted) during consume-upload-url!
        ;; so there's typically nothing to clean up from the legacy table
        {:id nil}))))

(defn list-uploaded-files
  "Lists all uploaded files for an app, returning path, url, and entity-id.
   Queries the $files entity type for file records with their storage URLs."
  [{:keys [app-id]}]
  (storage-beta/assert-storage-enabled! app-id)
  (let [;; Query all $files entities for this app
        files (app-file-model/get-all-for-app app-id)]
    (mapv (fn [{:keys [path entity_id] :as file}]
            {:path path
             :entity-id entity_id
             :location-id entity_id})
          files)))

;; Logic for legacy S3 upload/download URLs
;; -------------------------

(defn create-upload-url!
  "Creates a limited time url for uploading a file to Instant"
  [{:keys [app-id path skip-perms-check? current-user]}]
  (storage-beta/assert-storage-enabled! app-id)
  (when (not skip-perms-check?)
    (assert-storage-permission! "create" {:app-id app-id
                                          :path path
                                          :current-user current-user}))
  (let [{upload-id :id} (app-upload-url-model/create! {:app-id app-id :path path})]
    (str config/server-origin "/storage/" upload-id "/consume-upload-url")))

(defn consume-upload-url!
  "Consume an Instant upload url and if it's valid kicks off our upload process"
  [{:keys [upload-id content-type content-length]} file]
  (let [{app-id :app_id path :path expired-at :expired_at}
        (app-upload-url-model/consume! {:upload-id upload-id})]
    (when (or (not expired-at)
              (.isBefore (Date/.toInstant expired-at) (Instant/now)))
      (throw (ex/throw-validation-err!
              :app-upload-url
              upload-id
              "The upload URL is expired or invalid.")))
    (upload-file!
     {:app-id app-id
      :path path
      :content-type content-type
      :content-length content-length
      :skip-perms-check? true} file)))

(defn create-download-url
  "Returns a temporary url for downloading a file from Instant.
   Generic: delegates URL construction entirely to the configured storage provider.
   Coordinator never builds provider-specific URLs (e.g. res.cloudinary.com).
   Handles both modern ($files entity) and legacy (app_upload_urls) upload flows."
  [{:keys [app-id path skip-perms-check? current-user] :as ctx}]
  (storage-beta/assert-storage-enabled! app-id)
  (when (not skip-perms-check?)
    (assert-storage-permission! "view" {:app-id app-id
                                        :path path
                                        :current-user current-user}))
  (let [;; First try modern $files entity lookup
        file-record (app-file-model/get-by-path {:app-id app-id :path path})
        location-id (:location-id file-record)
        app-config (get-storage-config app-id)
        provider-type (or (:provider_type app-config) "cloudinary")
        provider-kw (case provider-type
                      "cloudinary" :cloudinary
                      "r2" :r2
                      "s3" :s3
                      :cloudinary)
        ctx-with-config (merge ctx
                               (when app-config
                                 {:storage-provider provider-kw
                                  :r2-account-id (:account_id app-config)
                                  :r2-access-key-id (:access_key_id app-config)
                                  :r2-secret-access-key (:secret_access_key app-config)
                                  :r2-bucket-name (:bucket_name app-config)
                                  :r2-endpoint (:endpoint app-config)
                                  :r2-public-base-url (:public_base_url app-config)
                                  :cloud-name (:cloud_name app-config)
                                  :api-key (:api_key app-config)
                                  :api-secret (:api_secret app-config)
                                  :upload-preset (:upload_preset app-config)}))]
    (if location-id
      ;; Modern $files entity - use location-id
      (if (and app-config (= "cloudinary" provider-type))
        (instant-cloudinary/file-url app-id location-id app-config (:content-type file-record))
        (storage-provider/location-id-url ctx-with-config app-id location-id))
      ;; Legacy fallback: check app_upload_urls
      (let [legacy-record (first (filter #(= path (:path %))
                                       (app-upload-url-model/list-by-app-id {:app-id app-id})))]
        (when legacy-record
          ;; For legacy uploads, path IS the location-id for Cloudinary
          (if (and app-config (= "cloudinary" provider-type))
            (instant-cloudinary/file-url app-id path app-config nil)
            (storage-provider/location-id-url ctx-with-config app-id path)))))))

(defn coerce-content-type [s]
  (let [coerced (string-util/coerce-non-blank-str s)]
    (when-not (#{"null" "undefined"} coerced)
      coerced)))

(comment
  (coerce-content-type "null")
  (coerce-content-type "undefined")
  (coerce-content-type "")
  (coerce-content-type "application/json"))
