(ns instant.model.app-storage-config
  (:require
   [honey.sql :as hsql]
   [instant.jdbc.aurora :as aurora]
   [instant.jdbc.sql :as sql]
   [instant.util.exception :as ex])
  (:import
   (java.time Instant)))

(defn get-by-app-id
  "Get active storage config for an app"
  ([{:keys [app-id]}]
   (get-by-app-id (aurora/conn-pool :read) {:app-id app-id}))
  ([conn {:keys [app-id]}]
   (sql/select-one ::get-by-app-id
                   conn
                   ["SELECT * FROM app_storage_configs
                     WHERE app_id = ?::uuid AND is_active = true
                     LIMIT 1"
                    app-id])))

(defn get-by-id
  ([{:keys [id]}]
   (get-by-id (aurora/conn-pool :read) {:id id}))
  ([conn {:keys [id]}]
   (sql/select-one ::get-by-id
                   conn
                   ["SELECT * FROM app_storage_configs WHERE id = ?::uuid" id])))

(defn create!
  ([params]
   (create! (aurora/conn-pool :write) params))
  ([conn {:keys [app-id provider-type cloud-name api-key api-secret upload-preset]}]
   ;; First, deactivate any existing configs for this app
   (sql/execute-one! conn
                     ["UPDATE app_storage_configs
                       SET is_active = false, updated_at = NOW()
                       WHERE app_id = ?::uuid AND is_active = true"
                      app-id])
   ;; Create new config
   (sql/execute-one! conn
                     (hsql/format
                      {:insert-into :app_storage_configs
                       :values [{:app_id app-id
                                 :provider_type (or provider-type "cloudinary")
                                 :cloud_name cloud-name
                                 :api_key api-key
                                 :api_secret api-secret
                                 :upload_preset upload-preset
                                 :is_active true}]
                       :returning [:*]}))))

(defn update!
  ([params]
   (update! (aurora/conn-pool :write) params))
  ([conn {:keys [id app-id] :as params}]
   (let [update-fields (->> (select-keys params [:provider_type :cloud_name :api_key :api_secret :upload_preset :bucket_name :region :access_key_id :secret_access_key :is_active])
                            (filter (fn [[k v]] (some? v)))
                            (into {}))]
     (when (seq update-fields)
       (sql/execute-one! conn
                         (hsql/format
                          {:update :app_storage_configs
                           :set (merge update-fields {:updated_at (Instant/now)})
                           :where [:= :id id]
                           :returning [:*]}))))))

(defn delete!
  ([params]
   (delete! (aurora/conn-pool :write) params))
  ([conn {:keys [id]}]
   (sql/execute-one! conn
                     ["DELETE FROM app_storage_configs WHERE id = ?::uuid RETURNING *" id])))

(defn list-by-app-id
  ([{:keys [app-id]}]
   (list-by-app-id (aurora/conn-pool :read) {:app-id app-id}))
  ([conn {:keys [app-id]}]
   (sql/select ::list-by-app-id
               conn
               ["SELECT * FROM app_storage_configs WHERE app_id = ?::uuid ORDER BY created_at DESC" app-id])))
