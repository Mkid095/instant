(ns instant.resend
  (:require
    [clj-http.client :as clj-http]
    [instant.config :as config]
    [instant.util.json :refer [->json]]
    [instant.util.tracer :as tracer]
    [instant.util.exception :as ex]))

(defn throw-send-error!
  "Translates a failed Resend send into a typed instant-exception."
  [e to]
  (let [status (-> e ex-data :status)
        body (try
               (-> e ex-data :body)
               (catch Exception _ nil))]
    (tracer/add-data! {:attributes {:resend-status status
                                    :resend-error body}})
    (ex/throw-email-send-failed!
     "We weren't able to send the email."
     {:recipient (if (coll? to) (-> to first :email) to)}
     e)))

(defn- extract-email [recipient]
  (if (map? recipient)
    (:email recipient)
    recipient))

(defn send! [{:keys [from to cc bcc subject html reply-to]}]
  (let [recipients (if (coll? to)
                     (mapv extract-email to)
                     [to])
        from-email (if (map? from)
                     (:email from)
                     from)
        reply-to-email (or reply-to (config/email-reply-to))
        body {:from from-email
              :to recipients
              :subject subject
              :html html
              :reply-to reply-to-email}]
    (if-not (config/resend-send-enabled?)
      (tracer/with-span! {:name "resend/send-disabled"
                          :attributes body}
        (tracer/record-info!
         {:name "resend-disabled"
          :attributes
          {:msg "Resend is disabled, add RESEND_API_KEY to config to enable"}}))
      (tracer/with-span!
        {:name "resend/send"
         :attributes {:body body}}
        (try
          (clj-http/post
           "https://api.resend.com/emails"
           {:headers {"Authorization" (str "Bearer " (config/resend-api-key))
                      "Content-Type" "application/json"}
            :body (->json body)})
          (catch Exception e
            (throw-send-error! e recipients)))))))
