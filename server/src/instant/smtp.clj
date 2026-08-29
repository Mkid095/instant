(ns instant.smtp
  (:require
    [clojure.string :as string]
    [instant.config :as config]
    [instant.util.tracer :as tracer]
    [instant.util.exception :as ex])
  (:import
    [java.io BufferedReader InputStreamReader OutputStreamWriter PrintWriter]
    [java.net Socket]))

(set! *warn-on-reflection* true)

(defn- encode-base64 [s]
  (let [encoder (java.util.Base64/getEncoder)]
    (.encodeToString encoder (.getBytes ^String s "UTF-8"))))

(defn- smtp-read-line! [^BufferedReader reader]
  (let [line (.readLine reader)]
    (when (nil? line)
      (throw (ex-info "SMTP connection closed unexpectedly" {})))
    line))

(defn- smtp-send! [^PrintWriter writer line]
  (.println writer line)
  (.flush writer))

(defn- smtp-expect! [^BufferedReader reader expected]
  (let [response (smtp-read-line! reader)]
    (when-not (string/starts-with? response expected)
      (throw (ex-info (str "Unexpected SMTP response: " response)
                      {:response response})))
    response))

(defn send! [{:keys [from to subject html reply-to] :or {reply-to ""}}]
  (let [host (config/smtp-host)
        port (config/smtp-port)
        user (config/smtp-user)
        pass (config/smtp-password)
        recipients (if (coll? to)
                     (mapv #(if (map? %) (:email %) %) to)
                     [to])
        auth? (and (not (string/blank? user))
                   (not (string/blank? pass)))
        from-email (if (map? from) (:email from) from)
        reply-to-email (or reply-to from-email)]
    (if-not (config/smtp-send-enabled?)
      (tracer/with-span! {:name "smtp/send-disabled"
                          :attributes {:host host}}
        (tracer/record-info!
         {:name "smtp-disabled"
          :attributes
          {:msg "SMTP is disabled, configure SMTP_HOST and SMTP_USER/SMTP_PASSWORD"}}))
      (tracer/with-span! {:name "smtp/send"
                          :attributes {:host host
                                       :port port
                                       :to recipients}}
        (try
          (with-open [socket (Socket. host port)
                      writer (PrintWriter. (OutputStreamWriter. (.getOutputStream socket) "UTF-8") true)
                      reader (BufferedReader. (InputStreamReader. (.getInputStream socket) "UTF-8"))]
            (smtp-expect! reader "220")
            (smtp-send! writer "EHLO instant-selfhosted")
            (smtp-expect! reader "250")
            (when auth?
              (smtp-send! writer "AUTH LOGIN")
              (smtp-expect! reader "334")
              (smtp-send! writer (encode-base64 user))
              (smtp-expect! reader "334")
              (smtp-send! writer (encode-base64 pass))
              (smtp-expect! reader "235"))
            (smtp-send! writer (str "MAIL FROM:<" from-email ">"))
            (smtp-expect! reader "250")
            (doseq [recipient recipients]
              (smtp-send! writer (str "RCPT TO:<" recipient ">"))
              (smtp-expect! reader "250"))
            (smtp-send! writer "DATA")
            (smtp-expect! reader "354")
            (let [msg (str "From: " from-email "\r\n"
                           "To: " (string/join ", " recipients) "\r\n"
                           (when reply-to-email (str "Reply-To: " reply-to-email "\r\n"))
                           "Subject: " subject "\r\n"
                           "Content-Type: text/html; charset=UTF-8\r\n"
                           "MIME-Version: 1.0\r\n"
                           "\r\n"
                           html "\r\n.\r\n")]
              (.write writer msg 0 (.length msg))
              (.flush writer))
            (smtp-expect! reader "250")
            (smtp-send! writer "QUIT")
            (smtp-read-line! reader)
            true)
          (catch Exception e
            (tracer/add-data! {:attributes {:smtp-error (.getMessage e)}})
            (ex/throw-email-send-failed!
             "We weren't able to send the email via SMTP."
             {:recipient (first recipients)}
             e))))))
)
