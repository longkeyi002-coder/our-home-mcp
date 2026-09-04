plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

if (file("google-services.json").exists()) {
    pluginManager.apply("com.google.gms.google-services")
}

fun configuredValue(name: String): String = providers.gradleProperty(name).orNull ?: System.getenv(name).orEmpty()
fun buildConfigString(value: String): String = "\"${value.replace("\\", "\\\\").replace("\"", "\\\"")}\""

val configuredVersionCode = configuredValue("OUR_HOME_VERSION_CODE").toIntOrNull()?.takeIf { it > 0 } ?: 1
val configuredVersionName = configuredValue("OUR_HOME_VERSION_NAME").ifBlank { "0.1.0" }
val stableKeystorePath = configuredValue("OUR_HOME_ANDROID_KEYSTORE_PATH")
val stableKeystorePassword = configuredValue("OUR_HOME_ANDROID_KEYSTORE_PASSWORD")
val stableKeyAlias = configuredValue("OUR_HOME_ANDROID_KEY_ALIAS")
val stableKeyPassword = configuredValue("OUR_HOME_ANDROID_KEY_PASSWORD")
val stableSigningAvailable = listOf(
    stableKeystorePath,
    stableKeystorePassword,
    stableKeyAlias,
    stableKeyPassword,
).all { it.isNotBlank() }

android {
    namespace = "com.hermes.companion"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.hermes.companion"
        minSdk = 26
        targetSdk = 35
        versionCode = configuredVersionCode
        versionName = configuredVersionName

        // OH-P1.11: private builds may inject a default Runtime and register-only
        // enrollment credential. Values are intentionally empty in source control.
        buildConfigField("String", "DEFAULT_RUNTIME_URL", buildConfigString(configuredValue("OUR_HOME_DEFAULT_RUNTIME_URL")))
        buildConfigField("String", "ENROLLMENT_TOKEN", buildConfigString(configuredValue("OUR_HOME_ENROLLMENT_TOKEN")))

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables { useSupportLibrary = true }
    }

    signingConfigs {
        if (stableSigningAvailable) {
            create("ourHomeStable") {
                storeFile = file(stableKeystorePath)
                storePassword = stableKeystorePassword
                keyAlias = stableKeyAlias
                keyPassword = stableKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            if (stableSigningAvailable) signingConfig = signingConfigs.getByName("ourHomeStable")
        }
        release {
            isMinifyEnabled = false
            if (stableSigningAvailable) signingConfig = signingConfigs.getByName("ourHomeStable")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { compose = true; buildConfig = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation(platform("com.google.firebase:firebase-bom:33.8.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")
    implementation("com.google.firebase:firebase-installations-ktx")

    testImplementation("org.jetbrains.kotlin:kotlin-test:2.0.21")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.room:room-testing:2.6.1")
}
