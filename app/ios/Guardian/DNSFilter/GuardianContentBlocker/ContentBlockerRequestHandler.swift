import Foundation

/// Safari Content Blocker extension entry point (`NSExtensionPrincipalClass` in this target's
/// `Info.plist`). A content blocker extension cannot do network I/O or arbitrary per-request
/// computation — it is a pure JSON-file server: Safari loads whatever rules JSON it hands back,
/// once, whenever the extension is (re)loaded. This class contains no filtering logic itself;
/// the actual rules are generated app-side from `ContentFilterPolicy` by
/// `packages/domain/src/ios/contentBlockerRules.ts`'s `buildContentBlockerRules` and written into
/// the shared App Group container by the host app (Guardian) whenever the family's policy syncs,
/// followed by a call to `SFContentBlockerManager.reloadContentBlocker(withIdentifier:)` from the
/// host app to ask Safari to re-fetch them via this handler.
final class ContentBlockerRequestHandler: NSObject, NSExtensionRequestHandling {
    /// Must match the App Group entitlement shared by both this extension target
    /// (`GuardianContentBlocker.entitlements`) and the main app target's own entitlements file.
    private static let appGroupIdentifier = "group.com.guardian.app"
    private static let rulesFileName = "contentBlockerRules.json"

    func beginRequest(with context: NSExtensionContext) {
        let attachment = NSItemProvider(contentsOf: Self.resolveRulesURL())
            ?? NSItemProvider(item: Self.emptyRulesFallback as NSSecureCoding, typeIdentifier: "public.json")
        let item = NSExtensionItem()
        item.attachments = [attachment]
        context.completeRequest(returningItems: [item], completionHandler: nil)
    }

    /// Prefers the App Group's shared file (written by the host app from the family's live
    /// policy). Falls back to this extension's own bundled `contentBlockerRules.json` (checked
    /// into the extension target, always just `[]`) for the case the host app has never
    /// synced a policy yet — Safari requires *some* valid JSON array, never a missing file.
    private static func resolveRulesURL() -> URL? {
        if let containerURL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupIdentifier) {
            let sharedURL = containerURL.appendingPathComponent(rulesFileName)
            if FileManager.default.fileExists(atPath: sharedURL.path) {
                return sharedURL
            }
        }
        return Bundle.main.url(forResource: "contentBlockerRules", withExtension: "json")
    }

    /// Last-resort in-memory fallback if even the bundled JSON resource is somehow missing.
    private static let emptyRulesFallback = "[]".data(using: .utf8)! as NSData
}
