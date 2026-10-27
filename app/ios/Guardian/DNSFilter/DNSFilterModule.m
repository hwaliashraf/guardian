#import <React/RCTBridgeModule.h>

// Objective-C companion required to register the Swift `DNSFilterModule` class (see
// DNSFilterModule.swift's doc comment) with React Native's native module bridge —
// `RCT_EXPORT_MODULE`/`RCT_EXPORT_METHOD` are Objective-C-only macros, so a Swift-authored
// module is instead registered via `RCT_EXTERN_MODULE`/`RCT_EXTERN_METHOD` in a tiny .m file
// like this one. Not a .swift file — `xcrun swiftc -typecheck` does not apply; this needs the
// full Xcode/Pods project (React/RCTBridgeModule.h) to compile, same as DNSFilterModule.swift.
@interface RCT_EXTERN_MODULE(DNSFilterModule, NSObject)

RCT_EXTERN_METHOD(installProfile:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(removeProfile:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(isActive:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
