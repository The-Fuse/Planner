import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// Shape of the pomodoro Live Activity. Compiled into BOTH the app target
/// (which starts/updates/ends the activity) and the widget extension (which
/// renders it on the Lock Screen and in the Dynamic Island).
@available(iOS 16.1, *)
struct PomodoroAttributes: ActivityAttributes {
    /// Everything that changes as the session runs.
    struct ContentState: Codable, Hashable {
        /// "focus" or "break"
        var phase: String
        /// Wall-clock end of the current phase — drives the countdown natively,
        /// so the timer keeps ticking without the app being awake.
        var endsAt: Date
        /// Start of the current phase, for the progress bar's span.
        var startedAt: Date
        var paused: Bool
        /// Seconds left when paused (the countdown is frozen, so `endsAt`
        /// can't be trusted while `paused` is true).
        var remaining: Int
        /// Completed focus phases this session.
        var cycles: Int
        /// A long break rather than a short one.
        var longBreak: Bool

        var isBreak: Bool { phase == "break" }
    }

    /// Fixed for the life of the session.
    var subject: String
    var task: String
    /// Subject accent, "#RRGGBB" — mirrors subjectColors.ts on the web side.
    var colorHex: String
}
#endif
