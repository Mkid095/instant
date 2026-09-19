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
  (let [md (MessageDigest/getInstance "SHA-1")]
    (->> (.digest md (.getBytes ^String s "UTF-8"))
         (format "%040x"))))

(defn- signature [timestamp params api-secret]
  (let [sorted-params (->> params
                           (sort)
                           (filter #(not= "" (second %)))
                           (map #(str (first %) "=" (second %)))
                           (string/join "&"))
        sig-string (str sorted-params timestamp api-secret)]
    (sha1 sig-string)))

(defn- build-upload-url [cloud-name]
  (str "https://api.cloudinary.com/v1_1/" cloud-name "/auto/upload"))

(defn location-id->bin
  "We add a bin to the location id to scale Cloudinary performance."
  ^long [^String location-id]
  (mod (Math/abs (.hashCode location-id)) 10))

(defn ->public-id
  "Cloudinary public ID has the shape of app-id/bin/location-id"
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
              response-body (when is (slurp is))]
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
            (let [parsed (cheshire.core/parse-string response-body true)]
              {:public-id public-id
               :secure-url (get parsed "secure_url")
               :url (get parsed "url")
               :format (get parsed "format")
               :bytes (get parsed "bytes")
               :width (get parsed "width")
               :height (get parsed "height")})))))))

(defn delete-file! [app-id location-id & [opts]]
  (when location-id
    (tracer/with-span! {:name "delete-file-from-cloudinary"
                        :attributes {:app-id app-id
                                     :location-id location-id}}
      (let [public-id (->public-id app-id location-id)
            cloud-name (or (:cloud-name opts) (config/cloudinary-cloud-name))
            timestamp (long (/ (System/currentTimeMillis) 1000))
            api-secret (or (:api-secret opts) (config/cloudinary-api-secret))
            api-key (or (:api-key opts) (config/cloudinary-api-key))
            sig (signature timestamp {"public_id" public-id} api-secret)
            url (URL. (str "https://api.cloudinary.com/v1_1/"
                           cloud-name
                           "/image/destroy"))
            body (->> [["timestamp" (str timestamp)]
                       ["public_id" public-id]
                       ["signature" sig]
                       ["api_key" api-key]]
                      (map #(str (first %) "="
                                 (.toString (URLEncoder/encode (second %) "UTF-8"))))
                      (string/join "&"))]
        (with-open [conn ^HttpURLConnection (.openConnection url)]
          (.setRequestMethod conn "POST")
          (.setDoOutput conn true)
          (.setRequestProperty conn "Content-Type" "application/x-www-form-urlencoded")
          (with-open [w (OutputStreamWriter. (.getOutputStream conn) "UTF-8")]
            (.write w body))
          (let [response-code (.getResponseCode conn)
                response-body (slurp (.getInputStream conn))]
            (when-not (= 200 response-code)
              (tracer/add-data! {:attributes {:cloudinary-delete-status response-code
                                              :cloudinary-delete-body response-body}})
              (throw (ex-info (str "Cloudinary delete failed: " response-body)
                              {:status response-code
                               :body response-body
                               :cloud-name cloud-name
                               :public-id public-id})))))))))

(defn get-file-url [app-id location-id & [opts]]
  (let [public-id (->public-id app-id location-id)
        cloud-name (or (:cloud-name opts) (config/cloudinary-cloud-name))
        base-url (str "https://res.cloudinary.com/"
                      cloud-name
                      "/image/upload/"
                      public-id)]
    base-url))
