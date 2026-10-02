#!/bin/bash
set -e

JAVA_FLAGS="${JAVA_OPTS} \
    --add-modules java.se \
    --add-exports java.base/jdk.internal.ref=ALL-UNNAMED \
    --add-opens java.base/java.lang=ALL-UNNAMED \
    --add-opens java.base/sun.nio.ch=ALL-UNNAMED \
    --add-opens java.management/sun.management=ALL-UNNAMED \
    --add-opens jdk.management/com.sun.management.internal=ALL-UNNAMED \
    -Djava.awt.headless=true \
    -server"

if [ "${1:-}" = "generate-override-config" ]; then
    export OVERRIDE_CONFIG_PATH="${2:-resources/config/override.edn}"

    java ${JAVA_FLAGS} \
        -cp resources:target/instant-standalone.jar \
        clojure.main \
        -e "(require 'tasks) (tasks/generate-override-config nil)"
    exit 0
fi

echo "Bootstrapping self-hosted server..."
java ${JAVA_FLAGS} \
    -cp resources:target/instant-standalone.jar \
    clojure.main \
    -e "(require 'tasks) (tasks/bootstrap-for-oss nil)"

echo "Starting server..."
exec java ${JAVA_FLAGS} \
    -cp resources:target/instant-standalone.jar \
    instant.core
