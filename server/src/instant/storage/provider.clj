(ns instant.storage.provider
  "Storage provider abstraction. Cloudinary is the only enabled provider
   for now. S3 and R2 are temporarily disabled.

   Provider selection priority:
     1. ctx[:storage-provider] (per-call override, set by the coordinator
        when a per-app config exists)
     2. STORAGE_PROVIDER environment variable
     3. default :cloudinary

   All providers MUST return a normalized upload result:
     {:location :size :content-type :content-disposition :provider-data}
   Anything provider-specific belongs inside :provider-data."
  (:require [instant.config :as config]
            [instant.storage.s3 :as instant-s3]
            [instant.storage.cloudinary :as instant-cloudinary]
            [instant.storage.r2 :as instant-r2]))

(defn- effective-provider
  "Resolve which provider to use: ctx override > env var > default :cloudinary.
   S3 and R2 are currently disabled and will throw if selected."
  [ctx]
  (let [selected (or (:storage-provider ctx) (config/storage-provider) :cloudinary)]
    (when (contains? #{:s3 :r2} selected)
      (throw (ex-info (str "Storage provider " selected " is temporarily disabled. "
                           "Only Cloudinary is currently enabled.")
                      {:type :storage/provider-disabled
                       :provider selected
                       :enabled-providers #{:cloudinary}})))
    selected))

(defn upload-file!
  [{:keys [app-id location-id] :as ctx} file_]
  (case (effective-provider ctx)
    :cloudinary (instant.storage.cloudinary/upload-file! ctx file_)
    ;; S3 / R2 temporarily disabled
    ))

(defn get-object-metadata
  "Three forms supported:
     - (get-object-metadata ctx app-id location-id)  - provider-aware
     - (get-object-metadata bucket-name app-id location-id)  - explicit S3 bucket (disabled)"
  ([ctx-or-bucket app-id location-id]
   (if (map? ctx-or-bucket)
     (case (effective-provider ctx-or-bucket)
       :cloudinary
       (let [base-url (instant.storage.cloudinary/get-file-url app-id location-id)]
         {:content-disposition nil
          :content-type nil
          :content-length nil
          :etag nil
          :last-modified nil
          :url base-url}))
     (throw (ex-info "S3 bucket-form get-object-metadata is temporarily disabled"
                     {:type :storage/provider-disabled})))))

(defn delete-file! [ctx app-id location-id & [content-type]]
  (case (effective-provider ctx)
    :cloudinary (instant.storage.cloudinary/delete-file! app-id location-id (when content-type {:content-type content-type}))))

(defn bulk-delete-files! [ctx app-id location-ids]
  (case (effective-provider ctx)
    :cloudinary
    (doseq [location-id location-ids]
      (instant.storage.cloudinary/delete-file! app-id location-id))))

(defn location-id-url [ctx app-id location-id & [content-type]]
  (case (effective-provider ctx)
    :cloudinary (instant.storage.cloudinary/get-file-url app-id location-id (when content-type {:content-type content-type}))))
