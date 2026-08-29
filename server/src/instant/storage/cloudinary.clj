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

(defn- signature [timestamp params]
  (let [sorted-params (->> params
                           (sort)
                           (filter #(not= "" (second %)))
                           (map #(str (first %) "=" (second %)))
                           (string/join "&"))
        sig-string (str sorted-params timestamp (config/cloudinary-api-secret))]
    (sha1 sig-string)))

(defn- build-upload-url []
  (str "https://api.cloudinary.com/v1_1/" (config/cloudinary-cloud-name) "/auto/upload"))

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

(defn upload-file! [{:keys [app-id location-id content-type] :as ctx} file]
  (tracer/with-span! {:name "upload-file-to-cloudinary"
                      :attributes {:app-id app-id
                                   :location-id location-id
                                   :content-type content-type}}
    (let [timestamp (long (/ (System/currentTimeMillis) 1000))
          public-id (->public-id app-id location-id)
          sig (signature timestamp {"public_id" public-id
                                     "folder" (str "instant/" app-id)})
          upload-url (build-upload-url)]
      (let [boundary "----CloudinaryBoundary123"
            baos (ByteArrayOutputStream.)
            os baos]
        (doseq [[key value] [["timestamp" (str timestamp)]
                              ["public_id" public-id]
                              ["folder" (str "instant/" app-id)]
                              ["signature" sig]
                              ["api_key" (config/cloudinary-api-key)]]]
          (.write os (str "--" boundary "\r\n"
                          "Content-Disposition: form-data; name=\"" key "\"\r\n\r\n"
                          value "\r\n")
                  0
                  (.length (str "--" boundary "\r\n"
                                "Content-Disposition: form-data; name=\"" key "\"\r\n\r\n"
                                value "\r\n"))))
        (let [file-header (str "--" boundary "\r\n"
                               "Content-Disposition: form-data; name=\"file\"; filename=\"file\"\r\n"
                               "Content-Type: " (or content-type "application/octet-stream") "\r\n\r\n")
              file-footer (str "\r\n--" boundary "--\r\n")
              file-bytes (.readAllBytes ^InputStream file)]
          (.write os file-header 0 (.length file-header))
          (.write os file-bytes 0 (.length file-bytes))
          (.write os file-footer 0 (.length file-footer)))
        (.flush os)
        (let [body (.toByteArray baos)
              conn ^HttpURLConnection (.openConnection (URL. upload-url))]
          (.setRequestMethod conn "POST")
          (.setDoOutput conn true)
          (.setRequestProperty conn "Content-Type" (str "multipart/form-data; boundary=" boundary))
          (.setRequestProperty conn "Content-Length" (str (.length body)))
          (.setRequestProperty conn "Authorization" "disable-publication")
          (.write ^OutputStream (.getOutputStream conn) body 0 (.length body))
          (.flush ^OutputStream (.getOutputStream conn))
          (let [response-code (.getResponseCode conn)
                is (if (>= response-code 400)
                     (.getErrorStream conn)
                     (.getInputStream conn))
                response-body (when is (slurp is))]
            (if (>= response-code 400)
              (throw (ex-info (str "Cloudinary upload failed: " response-body)
                              {:status response-code
                               :body response-body}))
              (let [parsed (cheshire.core/parse-string response-body true)]
                {:public-id public-id
                 :secure-url (get parsed "secure_url")
                 :url (get parsed "url")
                 :format (get parsed "format")
                 :bytes (get parsed "bytes")
                 :width (get parsed "width")
                 :height (get parsed "height")}))))))))

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

(defn delete-file! [app-id location-id]
  (when location-id
    (let [public-id (->public-id app-id location-id)
          timestamp (long (/ (System/currentTimeMillis) 1000))
          sig (signature timestamp {"public_id" public-id})
          url (URL. (str "https://api.cloudinary.com/v1_1/"
                         (config/cloudinary-cloud-name)
                         "/image/destroy"))
          body (->> [["timestamp" (str timestamp)]
                     ["public_id" public-id]
                     ["signature" sig]
                     ["api_key" (config/cloudinary-api-key)]]
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
                                            :cloudinary-delete-body response-body}})))))))

(defn get-file-url [app-id location-id]
  (let [public-id (->public-id app-id location-id)
        base-url (str "https://res.cloudinary.com/"
                      (config/cloudinary-cloud-name)
                      "/image/upload/"
                      public-id)]
    base-url))
