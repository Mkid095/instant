(ns instant.storage.provider
  "Storage provider abstraction. Dispatches to S3/MinIO or Cloudinary
   based on STORAGE_PROVIDER environment variable."
  (:require [instant.config :as config]
            [instant.storage.s3 :as instant-s3]
            [instant.storage.cloudinary :as instant-cloudinary]))

(defn upload-file!
  [{:keys [app-id location-id] :as ctx} file_]
  (case (config/storage-provider)
    :cloudinary (instant.storage.cloudinary/upload-file! ctx file_)
    ;; Default to S3/MinIO
    (instant.storage.s3/upload-file-to-s3 ctx file_)))

(defn get-object-metadata
  ([app-id location-id]
   (case (config/storage-provider)
     :cloudinary
     (let [base-url (instant.storage.cloudinary/get-file-url app-id location-id)]
       ;; Return metadata in the same shape as S3 metadata for compatibility
       {:content-disposition nil
        :content-type nil
        :content-length nil
        :etag nil
        :last-modified nil
        :url base-url})
     (instant.storage.s3/get-object-metadata app-id location-id)))
  ([bucket-name app-id location-id]
   (instant.storage.s3/get-object-metadata bucket-name app-id location-id)))

(defn delete-file! [app-id location-id]
  (case (config/storage-provider)
    :cloudinary (instant.storage.cloudinary/delete-file! app-id location-id)
    (instant.storage.s3/delete-file! app-id location-id)))

(defn bulk-delete-files! [app-id location-ids]
  (case (config/storage-provider)
    :cloudinary
    (doseq [location-id location-ids]
      (instant.storage.cloudinary/delete-file! app-id location-id))
    (instant.storage.s3/bulk-delete-files! app-id location-ids)))

(defn location-id-url [app-id location-id]
  (case (config/storage-provider)
    :cloudinary (instant.storage.cloudinary/get-file-url app-id location-id)
    (instant.storage.s3/location-id-url app-id location-id)))
