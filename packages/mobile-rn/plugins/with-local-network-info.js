const fs = require("node:fs");
const path = require("node:path");
const {
  AndroidConfig,
  IOSConfig,
  createRunOncePlugin,
  withDangerousMod,
  withXcodeProject,
} = require("expo/config-plugins");

const pluginName = "with-local-network-info";

const androidModuleSource = `package __PACKAGE_NAME__

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Collections

class LocalNetworkInfoModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "LocalNetworkInfo"

  @ReactMethod
  fun getLocalIPv4Address(promise: Promise) {
    promise.resolve(findLocalIpv4Address())
  }

  private fun findLocalIpv4Address(): String? {
    val preferredInterfaces = listOf("wlan0", "en0", "eth0", "ap0")
    val fallbackAddresses = mutableListOf<String>()

    for (networkInterface in Collections.list(NetworkInterface.getNetworkInterfaces())) {
      if (!networkInterface.isUp || networkInterface.isLoopback) continue
      for (address in Collections.list(networkInterface.inetAddresses)) {
        val ipv4Address = address as? Inet4Address ?: continue
        if (ipv4Address.isLoopbackAddress || !ipv4Address.isSiteLocalAddress) continue
        val hostAddress = ipv4Address.hostAddress?.substringBefore('%') ?: continue
        if (preferredInterfaces.contains(networkInterface.name)) {
          return hostAddress
        }
        fallbackAddresses.add(hostAddress)
      }
    }

    return fallbackAddresses.firstOrNull()
  }
}
`;

const androidPackageSource = `package __PACKAGE_NAME__

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class LocalNetworkInfoPackage : ReactPackage {
  override fun createNativeModules(
    reactContext: ReactApplicationContext
  ): List<NativeModule> = listOf(LocalNetworkInfoModule(reactContext))

  override fun createViewManagers(
    reactContext: ReactApplicationContext
  ): List<ViewManager<*, *>> = emptyList()
}
`;

const iosModuleSource = `#import <React/RCTBridgeModule.h>

#include <arpa/inet.h>
#include <ifaddrs.h>
#include <net/if.h>
#include <string.h>

static BOOL ALIsPrivateIPv4Address(const char *address) {
  struct in_addr ipv4Address;
  if (inet_pton(AF_INET, address, &ipv4Address) != 1) {
    return NO;
  }

  uint32_t hostOrderAddress = ntohl(ipv4Address.s_addr);
  uint8_t firstOctet = (uint8_t)((hostOrderAddress >> 24) & 0xFF);
  uint8_t secondOctet = (uint8_t)((hostOrderAddress >> 16) & 0xFF);

  if (firstOctet == 10) return YES;
  if (firstOctet == 172 && secondOctet >= 16 && secondOctet <= 31) return YES;
  if (firstOctet == 192 && secondOctet == 168) return YES;
  return NO;
}

static BOOL ALIsPreferredInterfaceName(const char *name) {
  return strcmp(name, "en0") == 0 || strcmp(name, "en1") == 0 ||
    strcmp(name, "bridge100") == 0;
}

@interface LocalNetworkInfo : NSObject <RCTBridgeModule>
@end

@implementation LocalNetworkInfo

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

+ (NSString *)findLocalIPv4Address {
  struct ifaddrs *interfaces = NULL;
  struct ifaddrs *current = NULL;
  NSString *fallbackAddress = nil;

  if (getifaddrs(&interfaces) != 0) {
    return nil;
  }

  for (current = interfaces; current != NULL; current = current->ifa_next) {
    if (current->ifa_addr == NULL || current->ifa_addr->sa_family != AF_INET) {
      continue;
    }
    if ((current->ifa_flags & IFF_UP) == 0 || (current->ifa_flags & IFF_LOOPBACK) != 0) {
      continue;
    }

    char addressBuffer[INET_ADDRSTRLEN];
    const struct sockaddr_in *socketAddress = (const struct sockaddr_in *)current->ifa_addr;
    const char *address = inet_ntop(
      AF_INET,
      &(socketAddress->sin_addr),
      addressBuffer,
      INET_ADDRSTRLEN
    );
    if (address == NULL || !ALIsPrivateIPv4Address(address)) {
      continue;
    }

    NSString *candidate = [NSString stringWithUTF8String:address];
    if (candidate.length == 0) {
      continue;
    }
    if (ALIsPreferredInterfaceName(current->ifa_name)) {
      freeifaddrs(interfaces);
      return candidate;
    }
    if (fallbackAddress == nil) {
      fallbackAddress = candidate;
    }
  }

  freeifaddrs(interfaces);
  return fallbackAddress;
}

RCT_REMAP_METHOD(
  getLocalIPv4Address,
  getLocalIPv4AddressWithResolver:(RCTPromiseResolveBlock)resolve
  rejecter:(RCTPromiseRejectBlock)reject
) {
  resolve([LocalNetworkInfo findLocalIPv4Address]);
}

@end
`;

function writeFileIfChanged(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (
    fs.existsSync(filePath) &&
    fs.readFileSync(filePath, "utf8") === contents
  ) {
    return;
  }
  fs.writeFileSync(filePath, contents);
}

function patchMainApplication(mainApplicationPath) {
  if (!fs.existsSync(mainApplicationPath)) {
    throw new Error(
      `${pluginName} could not find MainApplication.kt at ${mainApplicationPath}`,
    );
  }

  const contents = fs.readFileSync(mainApplicationPath, "utf8");
  if (contents.includes("LocalNetworkInfoPackage()")) {
    return;
  }

  const marker = "val packages = PackageList(this).packages";
  if (!contents.includes(marker)) {
    throw new Error(
      `${pluginName} could not locate the ReactPackage list in MainApplication.kt`,
    );
  }

  fs.writeFileSync(
    mainApplicationPath,
    contents.replace(
      marker,
      `${marker}\n            packages.add(LocalNetworkInfoPackage())`,
    ),
  );
}

function withAndroidLocalNetworkInfo(config) {
  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const packageName = AndroidConfig.Package.getPackage(modConfig);
      if (!packageName) {
        throw new Error(`${pluginName} requires expo.android.package`);
      }

      const sourceDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app/src/main/java",
        packageName.replace(/\./g, "/"),
      );
      writeFileIfChanged(
        path.join(sourceDir, "LocalNetworkInfoModule.kt"),
        androidModuleSource.replace(/__PACKAGE_NAME__/g, packageName),
      );
      writeFileIfChanged(
        path.join(sourceDir, "LocalNetworkInfoPackage.kt"),
        androidPackageSource.replace(/__PACKAGE_NAME__/g, packageName),
      );
      patchMainApplication(path.join(sourceDir, "MainApplication.kt"));

      return modConfig;
    },
  ]);
}

function withIosLocalNetworkInfo(config) {
  return withXcodeProject(config, (modConfig) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(
      modConfig.modRequest.projectRoot,
    );
    const relativeFilePath = `${projectName}/LocalNetworkInfoModule.m`;
    writeFileIfChanged(
      path.join(modConfig.modRequest.platformProjectRoot, relativeFilePath),
      iosModuleSource,
    );

    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: relativeFilePath,
      groupName: projectName,
      project: modConfig.modResults,
    });

    return modConfig;
  });
}

function withLocalNetworkInfo(config) {
  const configWithAndroidModule = withAndroidLocalNetworkInfo(config);
  return withIosLocalNetworkInfo(configWithAndroidModule);
}

module.exports = createRunOncePlugin(withLocalNetworkInfo, pluginName, "1.0.0");
