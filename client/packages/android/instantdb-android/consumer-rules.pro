# Consumer ProGuard rules for InstantDB Android SDK
# This file is used by apps that depend on this library

# Keep InstantDB classes
-keep class com.instantdb.** { *; }

# Kotlin Serialization
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Coroutines
-keepclassmembers class kotlinx.coroutines.** {
    volatile <fields>;
}
