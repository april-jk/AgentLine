plugins {
    id("com.android.application")
}

android {
    namespace = "com.agentline.deviceserver"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.agentline.deviceserver"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.6"
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}
