"Model for supporting backwards compatbility uploading from the frontend to S3"
(ns instant.model.app-upload-url
  (:require
   [instant.jdbc.aurora :as aurora]
   [instant.jdbc.sql :as sql]
   [honey.sql :as hsql])
  (:import
   (java.time Instant)
   (java.time.temporal ChronoUnit)))

(defn create!
  ([params] (create! (aurora/conn-pool :write) params))
  ([conn {:keys [app-id path]}]
   (sql/execute-one! conn
                     (hsql/format
                      {:insert-into :app_upload_urls
                       :values [{:id (random-uuid)
                                 :app-id app-id
                                 :path path
                                 :expired_at (-> (Instant/now)
                                                 (.plus 1 ChronoUnit/HOURS))}]
                       :returning [:id]}))))

(defn consume!
  ([params] (consume! (aurora/conn-pool :write) params))
  ([conn {:keys [upload-id]}]
   (sql/execute-one! conn
                     (hsql/format
                      {:delete-from :app_upload_urls
                       :where [:= :id upload-id]}))))
