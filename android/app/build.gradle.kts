import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "br.com.somainfo.quioco"
    compileSdk = 35

    defaultConfig {
        applicationId = "br.com.somainfo.quioco"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    // Two apps from the same code: imprime.ai (payments, dashboard) and imprime-free
    // (free unlimited printing, no payments, with ads for imprime.ai). Build Variants: fullDebug, freeDebug…
    flavorDimensions += "edition"
    productFlavors {
        create("full") {
            dimension = "edition"
            buildConfigField("boolean", "FREE", "false")
        }
        create("free") {
            dimension = "edition"
            // Package name on Google Play (permanent once published); same as the iOS bundle ID.
            applicationId = "br.com.somainfo.imprimefree"
            versionNameSuffix = "-free"
            buildConfigField("boolean", "FREE", "true")
        }
    }

    // Release signing for Google Play: keystore.properties (never committed) next to settings.gradle.kts:
    //   storeFile=/caminho/imprime-upload.jks  storePassword=…  keyAlias=upload  keyPassword=…
    val keystoreFile = rootProject.file("keystore.properties")
    if (keystoreFile.exists()) {
        val props = Properties().apply { keystoreFile.inputStream().use { load(it) } }
        signingConfigs {
            create("upload") {
                storeFile = file(props.getProperty("storeFile"))
                storePassword = props.getProperty("storePassword")
                keyAlias = props.getProperty("keyAlias")
                keyPassword = props.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystoreFile.exists()) signingConfig = signingConfigs.getByName("upload")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)

    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Gera o QR Code do Pix no próprio tablet.
    implementation("com.google.zxing:core:3.5.3")
}
