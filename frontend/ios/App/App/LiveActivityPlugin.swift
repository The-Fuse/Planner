import Foundation
import Capacitor

#if canImport(ActivityKit)
import ActivityKit
#endif

/// Drives the pomodoro Live Activity (Lock Screen + Dynamic Island) from the
/// web layer. Everything degrades to a no-op resolve when Live Activities are
/// unavailable (iOS < 16.2, or the user has turned them off), so the JS side
/// never has to branch on OS version.
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainActions", returnType: CAPPluginReturnPromise),
    ]

    /// Controls tapped on the Live Activity arrive here (see PomodoroIntents)
    /// and are relayed to the web layer, which owns the session's state.
    override public func load() {
        PomodoroControlBus.clear()
        // A Live Activity outlives its app by design, so one left behind by a
        // force-quit (or a crash) would sit on the Lock Screen forever. Nothing
        // can be running this early in launch, so anything still alive here is
        // an orphan.
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task {
                for stale in Activity<PomodoroAttributes>.activities {
                    await stale.end(nil, dismissalPolicy: .immediate)
                }
            }
        }
        #endif

        NotificationCenter.default.addObserver(
            forName: PomodoroControlBus.notification, object: nil, queue: .main
        ) { [weak self] note in
            guard let action = note.userInfo?["action"] as? String else { return }
            self?.notifyListeners("pomodoroAction", data: ["action": action])
        }
    }

    /// Actions queued while the web layer was asleep. Called on resume so a tap
    /// on a locked screen still lands.
    @objc func drainActions(_ call: CAPPluginCall) {
        call.resolve(["actions": PomodoroControlBus.drain()])
    }

    #if canImport(ActivityKit)
    /// The one in-flight session. A pomodoro is singular by nature.
    private var current: Any?

    @available(iOS 16.2, *)
    private var activity: Activity<PomodoroAttributes>? {
        get { current as? Activity<PomodoroAttributes> }
        set { current = newValue }
    }
    #endif

    @objc func isSupported(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled])
            return
        }
        #endif
        call.resolve(["supported": false])
    }

    @objc func start(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        guard #available(iOS 16.2, *) else {
            call.resolve(["started": false, "reason": "iOS < 16.2"]); return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            // Settings → UPSC → Live Activities is off.
            call.resolve(["started": false, "reason": "activities disabled in Settings"]); return
        }
        // Starting twice would leave an orphan on the Lock Screen.
        if activity != nil {
            update(call); return
        }
        let attributes = PomodoroAttributes(
            subject: call.getString("subject") ?? "Focus",
            task: call.getString("task") ?? "",
            colorHex: call.getString("colorHex") ?? "#ADC6FF"
        )
        // Taps aimed at a previous session must not leak into this one.
        PomodoroControlBus.clear()
        let initial = state(from: call)
        do {
            activity = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: initial, staleDate: staleDate(for: initial))
            )
            call.resolve(["started": true])
        } catch {
            CAPLog.print("[LiveActivity] request failed: \(error)")
            call.resolve(["started": false, "reason": "\(error)"])
        }
        #else
        call.resolve(["started": false, "reason": "ActivityKit unavailable"])
        #endif
    }

    @objc func update(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *), let activity {
            let next = state(from: call)
            // A phase flip is the moment worth interrupting for — ask the
            // system to surface the activity as a banner. Everything else
            // (pause, resume) updates quietly.
            var alert: AlertConfiguration?
            if call.getBool("alert") ?? false {
                alert = AlertConfiguration(
                    title: next.isBreak ? "Break time" : "Back to focus",
                    body: LocalizedStringResource(stringLiteral: next.isBreak
                        ? "\(Int(next.endsAt.timeIntervalSinceNow / 60) + 1)-minute break"
                        : activity.attributes.subject),
                    sound: .default
                )
            }
            Task {
                await activity.update(
                    ActivityContent(state: next, staleDate: staleDate(for: next)),
                    alertConfiguration: alert
                )
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }

    @objc func end(_ call: CAPPluginCall) {
        PomodoroControlBus.clear()
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *), let activity {
            self.activity = nil
            Task {
                await activity.end(nil, dismissalPolicy: .immediate)
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }

    #if canImport(ActivityKit)
    /// Reads a content state off the call. `endsAt`/`startedAt` arrive as epoch
    /// milliseconds so the JS side can hand over the same timestamps that drive
    /// its own countdown.
    @available(iOS 16.1, *)
    private func state(from call: CAPPluginCall) -> PomodoroAttributes.ContentState {
        let endsAtMs = call.getDouble("endsAt") ?? Date().timeIntervalSince1970 * 1000
        let startedAtMs = call.getDouble("startedAt") ?? Date().timeIntervalSince1970 * 1000
        return PomodoroAttributes.ContentState(
            phase: call.getString("phase") ?? "focus",
            endsAt: Date(timeIntervalSince1970: endsAtMs / 1000),
            startedAt: Date(timeIntervalSince1970: startedAtMs / 1000),
            paused: call.getBool("paused") ?? false,
            remaining: call.getInt("remaining") ?? 0,
            cycles: call.getInt("cycles") ?? 0,
            longBreak: call.getBool("longBreak") ?? false
        )
    }

    /// Backstop for an app that dies mid-session without reaching `end`: once a
    /// phase is well past due, the system greys the activity out instead of
    /// leaving a frozen timer on the Lock Screen. Launch-time cleanup in
    /// `load()` handles the case where the app comes back.
    @available(iOS 16.1, *)
    private func staleDate(for state: PomodoroAttributes.ContentState) -> Date {
        state.paused
            ? Date().addingTimeInterval(4 * 3600)
            : state.endsAt.addingTimeInterval(15 * 60)
    }
    #endif
}
