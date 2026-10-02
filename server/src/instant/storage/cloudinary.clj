(ns instant.storage.cloudinary
  (:require
    [clojure.string :as string]
    [instant.config :as config]
    [instant.util.tracer :as tracer])
  (:import
    [java.io InputStream ByteArrayOutputStream OutputStream OutputStreamWriter]
    [java.net HttpURLConnection URL URLEncoder]
    [java.security MessageDigest]))

(set! *warn-on-reflection* true)

(defn- sha1 [s]
  (let [md (MessageDigest/getInstance "SHA-1")
        bytes (.digest md (.getBytes ^String s "UTF-8"))]
    (apply str (map #(format "%02x" %) bytes))))

(defn- signature [timestamp params api-secret]
  (let [sorted-params (->> params
                           (sort)
                           (filter #(not= "" (second %)))
                           (map #(str (first %) "=" (second %)))
                           (string/join "&"))
        sig-string (str sorted-params "&timestamp=" timestamp api-secret)]
    (sha1 sig-string)))

(defn- build-upload-url [cloud-name]
  (str "https://api.cloudinary.com/v1_1/" cloud-name "/auto/upload"))

(defn location-id->bin
  "We add a bin to the location id to scale Cloudinary performance."
  ^long [^String location-id]
  (mod (Math/abs (.hashCode location-id)) 10))

(defn ->public-id
  "Cloudinary public ID has the shape of app-id/bin/location-id.
   When folder is set to instant/{app-id} during upload, the full path becomes
   instant/{app-id}/{public-id} = instant/{app-id}/{app-id}/{bin}/{location-id}."
  [app-id ^String location-id]
  (str app-id "/" (location-id->bin location-id) "/" location-id))

(defn public-id->app-id
  "Extract app-id from our Cloudinary public IDs"
  [public-id]
  (first (string/split public-id #"/")))

(defn public-id->bin
  "Extract bin from our Cloudinary public IDs"
  [public-id]
  (second (string/split public-id #"/")))

(defn public-id->location-id
  "Extract location-id from our Cloudinary public IDs"
  [public-id]
  (last (string/split public-id #"/")))

;; Normalized provider result
;; Coordinator and `$files` only ever see this shape. Cloudinary-specific
;; fields (public_id, secure_url, format, width, height) live in :provider-data
;; and are NEVER consumed by the coordinator. They may be inspected by
;; provider-specific code (e.g. download URL builder), but not by the
;; generic storage service.

(defn- ->normalized-upload-result
  "Translate Cloudinary's raw response into the generic StorageProvider
   upload contract. Throws :storage/missing-metadata if the provider
   response lacks the fields required to create a `$files` record.

   Note: cheshire parses with keyword keys, so we use :bytes not \"bytes\"."
  [parsed public-id]
  (let [bytes (:bytes parsed)
        secure-url (:secure_url parsed)]
    (when (nil? bytes)
      (tracer/add-data!
       {:attributes {:trace-step "missing-required-metadata"
                     :missing-field :bytes
                     :parsed-keys (when (map? parsed) (keys parsed))}})
      (throw (ex-info (str "Cloudinary upload response missing required field :bytes. "
                           "This usually means the upload was rejected by Cloudinary "
                           "(e.g. invalid upload preset, signature, or credentials).")
                      {:type :storage/missing-metadata
                       :provider :cloudinary
                       :missing-field :bytes
                       :parsed-keys (when (map? parsed) (keys parsed))})))
    {:location public-id
     :size bytes
     :content-type (or (:content-type parsed) (:resource_type parsed))
     :content-disposition nil
     :provider-data {:cloudinary/secure-url secure-url
                     :cloudinary/url (:url parsed)
                     :cloudinary/format (:format parsed)
                     :cloudinary/width (:width parsed)
                     :cloudinary/height (:height parsed)
                     :cloudinary/public-id public-id}}))

(defn upload-file! [{:keys [app-id location-id content-type cloud-name upload-preset] :as ctx} file]
  (tracer/with-span! {:name "upload-file-to-cloudinary"
                      :attributes {:app-id app-id
                                   :location-id location-id
                                   :content-type content-type}}
    (let [cloud-name (or cloud-name (config/cloudinary-cloud-name))
          _ (when (string/blank? cloud-name)
              (throw (ex-info "Cloudinary cloud name is required"
                              {:type :cloudinary-missing-config
                               :app-id app-id})))
          _ (tracer/add-data! {:attributes {:trace-step "cloud-name-resolved"
                                            :has-cloud-name (some? cloud-name)}})
          public-id (->public-id app-id location-id)
          upload-preset (or upload-preset "inspo-next")
          upload-url (build-upload-url cloud-name)
          boundary "----CloudinaryBoundary123"
          baos (ByteArrayOutputStream.)
          os baos]
      (doseq [[key value] [["upload_preset" upload-preset]
                            ["public_id" public-id]
                            ["folder" (str "instant/" app-id)]]]
        (let [part (.getBytes (str "--" boundary "\r\n"
                                   "Content-Disposition: form-data; name=\"" key "\"\r\n\r\n"
                                   value "\r\n") "UTF-8")]
          (.write os part 0 (count part))))
      (let [file-header (.getBytes (str "--" boundary "\r\n"
                                       "Content-Disposition: form-data; name=\"file\"; filename=\"file\"\r\n"
                                       "Content-Type: " (or content-type "application/octet-stream") "\r\n\r\n") "UTF-8")
            file-footer (.getBytes (str "\r\n--" boundary "--\r\n") "UTF-8")
            file-bytes (.readAllBytes ^InputStream file)]
        (.write os file-header 0 (count file-header))
        (.write os file-bytes 0 (count file-bytes))
        (.write os file-footer 0 (count file-footer)))
      (.flush os)
      (let [body (.toByteArray baos)
            body-len (alength ^bytes body)
            conn ^HttpURLConnection (.openConnection (URL. upload-url))]
        (.setRequestMethod conn "POST")
        (.setDoOutput conn true)
        (.setRequestProperty conn "Content-Type" (str "multipart/form-data; boundary=" boundary))
        (.setRequestProperty conn "Content-Length" (str body-len))
        (.setRequestProperty conn "Authorization" "disable-publication")
        (.write ^OutputStream (.getOutputStream conn) body 0 body-len)
        (.flush ^OutputStream (.getOutputStream conn))
        (let [response-code (.getResponseCode conn)
              is (if (>= response-code 400)
                   (.getErrorStream conn)
                   (.getInputStream conn))
              response-body (when is (slurp is))
              ;; Step 0: trace the return path BEFORE doing anything with the body
              _ (tracer/add-data! {:attributes {:trace-step "response-received"
                                                :response-code response-code
                                                :body-type (cond
                                                             (nil? response-body) "nil"
                                                             (string/blank? response-body) "blank"
                                                             (string/starts-with? (str response-body) "{") "json-object"
                                                             :else "other")
                                                :body-length (when response-body (count response-body))}})]
          (if (>= response-code 400)
            (do
              (tracer/add-data! {:attributes {:cloudinary-upload-status response-code
                                            :cloudinary-upload-body response-body
                                            :cloudinary-cloud-name cloud-name}})
              (throw (ex-info (str "Cloudinary upload failed: " response-body)
                              {:status response-code
                               :body response-body
                               :cloud-name cloud-name
                               :public-id public-id})))
            (let [parsed (try
                           (cheshire.core/parse-string response-body true)
                           (catch Throwable e
                             (tracer/add-data! {:attributes {:trace-step "parse-failed"
                                                               :exception-type (str (type e))
                                                               :exception-msg (.getMessage e)}})
                             (throw e)))]
              (tracer/add-data! {:attributes {:trace-step "parsed-successfully"
                                                :parsed-type (str (type parsed))
                                                :parsed-is-map (map? parsed)
                                                :parsed-is-nil (nil? parsed)
                                                :has-bytes (contains? parsed :bytes)
                                                :has-secure-url (contains? parsed :secure_url)
                                                :has-format (contains? parsed :format)
                                                :bytes-value-type (when (contains? parsed :bytes)
                                                                    (str (type (:bytes parsed))))
                                                :bytes-value (when (contains? parsed :bytes)
                                                               (:bytes parsed))}})
              (->normalized-upload-result parsed public-id))))))))

(defn- resource-type [content-type]
  "Determine Cloudinary resource type from content-type.
   Accepts either a MIME type ('image/png', 'video/mp4', 'application/pdf')
   OR a Cloudinary resource_type ('image', 'video', 'raw') directly.
   - images: 'image'
   - videos: 'video'
   - everything else (audio, docs, arbitrary binaries): 'raw'"
  (cond
    (nil? content-type) "raw"
    (or (= content-type "image")
        (string/starts-with? content-type "image/")) "image"
    (or (= content-type "video")
        (string/starts-with? content-type "video/")) "video"
    :else "raw"))

(defn delete-file! [app-id location-id & [opts]]
  (when location-id
    (tracer/with-span! {:name "delete-file-from-cloudinary"
                        :attributes {:app-id app-id
                                     :location-id location-id}}
      (let [public-id (->public-id app-id location-id)
            full-public-id (str "instant/" app-id "/" public-id)
            cloud-name (or (:cloud-name opts) (config/cloudinary-cloud-name))
            content-type (:content-type opts)
            res-type (resource-type content-type)
            timestamp (long (/ (System/currentTimeMillis) 1000))
            api-secret (or (:api-secret opts) (config/cloudinary-api-secret))
            api-key (or (:api-key opts) (config/cloudinary-api-key))
            sig (signature timestamp {"public_id" full-public-id} api-secret)
            url (str "https://api.cloudinary.com/v1_1/" cloud-name "/" res-type "/destroy")
            body-str (str "timestamp=" timestamp
                       "&public_id=" (URLEncoder/encode full-public-id "UTF-8")
                       "&signature=" sig
                       "&api_key=" api-key)
            ^HttpURLConnection conn (doto ^HttpURLConnection (.openConnection (URL. url))
                                         (.setRequestMethod "POST")
                                         (.setDoOutput true)
                                         (.setRequestProperty "Content-Type" "application/x-www-form-urlencoded"))]
            (try
              (with-open [os (.getOutputStream conn)
                          w (OutputStreamWriter. os "UTF-8")]
                (.write w body-str))
              (let [response-code (.getResponseCode conn)
                    response-body (slurp (.getInputStream conn))]
                (tracer/add-data! {:attributes {:cloudinary-delete-response-code response-code
                                                :cloudinary-delete-response-body response-body
                                                :cloudinary-delete-body-str-len (count body-str)
                                                :cloudinary-delete-full-public-id full-public-id}})
                (when-not (= 200 response-code)
                  (throw (ex-info (str "Cloudinary delete failed: " response-body)
                                  {:status response-code
                                   :body response-body
                                   :cloud-name cloud-name
                                   :public-id full-public-id}))))
                (finally
                  (.disconnect conn)))))))

(defn get-file-url [app-id location-id & [opts]]
  (let [public-id (->public-id app-id location-id)
        cloud-name (or (:cloud-name opts) (config/cloudinary-cloud-name))
        content-type (:content-type opts)
        res-type (resource-type content-type)
        base-url (str "https://res.cloudinary.com/"
                      cloud-name
                      "/" res-type "/upload/"
                      "instant/" app-id "/"
                      public-id)]
    base-url))

(defn file-url
  "Build the Cloudinary URL for a stored file, given an app config map
   (with cloud_name) or falling back to the global config. This is the
   ONLY place in Instant where the Cloudinary URL shape is constructed.
   The coordinator never builds this URL."
  [app-id location-id app-config & [content-type]]
  (let [cloud-name (or (:cloud_name app-config) (config/cloudinary-cloud-name))
        public-id (->public-id app-id location-id)
        res-type (resource-type content-type)]
    (str "https://res.cloudinary.com/" cloud-name "/" res-type "/upload/instant/" app-id "/" public-id)))
