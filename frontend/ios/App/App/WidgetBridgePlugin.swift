import Foundation
import Capacitor
import WidgetKit

/// Receives the fetched plan from the web layer and shares it with the
/// home-screen widget via the app group, then asks WidgetKit to redraw.
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setPlan", returnType: CAPPluginReturnPromise)
    ]

    @objc func setPlan(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("json required")
            return
        }
        let shared = UserDefaults(suiteName: "group.com.kr1da.planner")
        shared?.set(json, forKey: "planJSON")
        shared?.set(Date().timeIntervalSince1970, forKey: "planJSONUpdated")
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve()
    }
}
