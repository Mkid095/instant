# ProGuard rules for InstantDB Android SDK

# Keep InstantDB classes
-keep class com.instantdb.** { *; }
-dontwarn com.instantdb.**

# SQLDelight
-keep class app.cash.sqldelight.** { *; }
-keep class com.instantdb.android.persistence.sqlite.** { *; }

# Kotlin Serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.instantdb.**$$serializer { *; }
-keepclassmembers class com.instantdb.** {
    *** Companion;
}
-keepclasseswithmembers class com.instantdb.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# Coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
-keepclassmembers class kotlinx.coroutines.** {
    volatile <fields>;
}

# AndroidX
-keep class androidx.** { *; }
-keep interface androidx.** { *; }

# R8 missing classes (safe to ignore at runtime)
-dontwarn java.lang.invoke.StringConcatFactory
