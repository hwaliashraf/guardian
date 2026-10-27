//
// Guardian-Bridging-Header.h
//
// Manual Xcode step this build environment cannot perform headlessly (no project-file editor
// available without Xcode/CocoaPods installed and a project GUI session — see SETUP.md's
// "Xcode / CocoaPods" section): this header must be set as the app target's
// SWIFT_OBJC_BRIDGING_HEADER build setting so DNSFilterModule.m's Objective-C
// RCT_EXTERN_MODULE declaration can see DNSFilterModule.swift's generated Obj-C interface, and
// so any Swift file in the target can see RCTBridgeModule's Obj-C-only types/macros if needed.
//
#import <React/RCTBridgeModule.h>
#import <React/RCTLog.h>
