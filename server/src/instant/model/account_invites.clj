(ns instant.model.account-invites
  (:require
   [instant.jdbc.aurora :as aurora]
   [instant.jdbc.sql :as sql]
   [instant.util.exception :as ex]
   [instant.util.hsql :as uhsql])
  (:import (java.security MessageDigest)
           (java.time Instant)))

(defn- sha256 [^String s]
  (let [digest (MessageDigest/getInstance "SHA-256")]
    (.update digest (.getBytes s "UTF-8"))
    (apply str (map #(format "%02x" %) (.digest digest)))))

;; Create query
(def create-q
  (uhsql/preformat
   {:insert-into :account_invites
    :values [{:id :?id
              :email :?email
              :token_hash :?token-hash
              :status [:inline "pending"]
              :expires_at [:+ :%now [:interval [:inline "3 days"]]]
              :invited_by :?invited-by}]}))

(defn create!
  "Creates a new account invite.
   params: {:email :token :invited-by}"
  ([params] (create! (aurora/conn-pool :write) params))
  ([conn {:keys [email token invited-by]}]
   (let [token-hash (sha256 token)
         query (uhsql/formatp create-q {:id (random-uuid)
                                        :email email
                                        :token-hash token-hash
                                        :invited-by invited-by})]
     (sql/execute-one! conn query))))

;; Get by token hash query
(def get-by-token-q
  (uhsql/preformat {:select :*
                    :from :account_invites
                    :where [:= :token_hash :?token-hash]}))

(defn get-by-token
  "Gets an invite by token hash.
   params: {:token}"
  ([params] (get-by-token (aurora/conn-pool :read) params))
  ([conn {:keys [token]}]
   (let [token-hash (sha256 token)
         query (uhsql/formatp get-by-token-q {:token-hash token-hash})]
     (sql/select-one ::get-by-token conn query))))

(defn get-by-token!
  "Gets an invite by token hash, throws if not found."
  ([params] (get-by-token! (aurora/conn-pool :read) params))
  ([conn params]
   (ex/assert-record!
    (get-by-token conn params)
    :account-invite
    {:args params})))

(defn validate-token!
  "Validates a token and returns the invite if valid.
   Throws if invite doesn't exist, is expired, or already used."
  ([params] (validate-token! (aurora/conn-pool :read) params))
  ([conn {:keys [token]}]
   (let [invite (get-by-token! conn {:token token})]
     (cond
       (= (:status invite) "accepted")
       (ex/throw-validation-err! :token token [{:message "This invitation has already been accepted."}])

       (= (:status invite) "revoked")
       (ex/throw-validation-err! :token token [{:message "This invitation has been revoked."}])

       (= (:status invite) "expired")
       (ex/throw-validation-err! :token token [{:message "This invitation has expired."}])

       (:accepted_at invite)
       (ex/throw-validation-err! :token token [{:message "This invitation has already been used."}])

       (neg? (.compareTo (.toInstant (:expires_at invite)) (Instant/now)))
       (ex/throw-validation-err! :token token [{:message "This invitation has expired."}])

       :else invite))))

;; Mark accepted query
(def mark-accepted-q
  (uhsql/preformat {:update :account_invites
                    :set {:status [:inline "accepted"]
                          :accepted_by :?accepted-by
                          :accepted_at :%now}
                    :where [:= :id :?id]}))

(defn mark-accepted!
  "Marks an invite as accepted.
   params: {:id :accepted-by}"
  ([params] (mark-accepted! (aurora/conn-pool :write) params))
  ([conn {:keys [id accepted-by]}]
   (let [query (uhsql/formatp mark-accepted-q {:id id :accepted-by accepted-by})]
     (sql/execute-one! conn query))))

;; Revoke query
(def revoke-q
  (uhsql/preformat {:update :account_invites
                    :set {:status [:inline "revoked"]}
                    :where [:= :id :?id]}))

(defn revoke!
  "Revokes an invite.
   params: {:id}"
  ([params] (revoke! (aurora/conn-pool :write) params))
  ([conn {:keys [id]}]
   (let [query (uhsql/formatp revoke-q {:id id})]
     (sql/execute-one! conn query))))

;; Get by id query
(def get-by-id-q
  (uhsql/preformat {:select :*
                    :from :account_invites
                    :where [:= :id :?id]}))

(defn get-by-id
  "Gets an invite by id."
  ([params] (get-by-id (aurora/conn-pool :read) params))
  ([conn {:keys [id]}]
   (let [query (uhsql/formatp get-by-id-q {:id id})]
     (sql/select-one ::get-by-id conn query))))

(defn get-by-id!
  "Gets an invite by id, throws if not found."
  ([params] (get-by-id! (aurora/conn-pool :read) params))
  ([conn params]
   (ex/assert-record!
    (get-by-id conn params)
    :account-invite
    {:args params})))

;; List by inviter query
(def list-by-inviter-q
  (uhsql/preformat {:select :*
                    :from :account_invites
                    :where [:= :invited_by :?invited-by]
                    :order-by [[:created_at :desc]]}))

(defn list-by-inviter
  "Lists all invites sent by a user.
   params: {:invited-by}"
  ([params] (list-by-inviter (aurora/conn-pool :read) params))
  ([conn {:keys [invited-by]}]
   (let [query (uhsql/formatp list-by-inviter-q {:invited-by invited-by})]
     (sql/select ::list-by-inviter conn query))))

;; Pending for email query
(def pending-for-email-q
  (uhsql/preformat {:select :*
                    :from :account_invites
                    :where [:and
                            [:= :email :?email]
                            [:= :status [:inline "pending"]]]}))

(defn pending-for-email
  "Gets all pending invites for an email that haven't expired.
   params: {:email}"
  ([params] (pending-for-email (aurora/conn-pool :read) params))
  ([conn {:keys [email]}]
   (let [query (uhsql/formatp pending-for-email-q {:email email})]
     (sql/select ::pending-for-email conn query))))
