#import <React/RCTBridgeModule.h>

// Objective-C companion required to register the Swift `ScreenTimeModule` class (see
// ScreenTimeModule.swift's doc comment) with React Native's native module bridge — same
// RCT_EXTERN_MODULE pattern T26's DNSFilterModule.m established. Not a .swift file — `xcrun
// swiftc -typecheck` does not apply; needs the full Xcode/Pods project (React/RCTBridgeModule.h)
// to compile.
@interface RCT_EXTERN_MODULE(ScreenTimeModule, RCTEventEmitter)

RCT_EXTERN_METHOD(requestAuthorization:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(getAuthorizationStatus:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(applyPolicy:(NSDictionary *)policy
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
