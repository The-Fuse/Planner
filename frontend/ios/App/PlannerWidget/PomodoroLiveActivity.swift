import ActivityKit
import WidgetKit
import SwiftUI

// MARK: - Colour

private let breakAccent = Color(hex: 0x68D3FF)

extension Color {
    /// "#RRGGBB" → Color, falling back to the primary accent.
    init(hexString: String) {
        var s = hexString.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { self = primaryAccent; return }
        self.init(hex: v)
    }
}

@available(iOS 16.1, *)
private extension PomodoroAttributes.ContentState {
    /// Break phases drop the subject colour for a common break blue.
    func accent(_ attrs: PomodoroAttributes) -> Color {
        isBreak ? breakAccent : Color(hexString: attrs.colorHex)
    }
    var label: String {
        isBreak ? (longBreak ? "LONG BREAK" : "BREAK") : "FOCUS"
    }
    /// Frozen "MM:SS" for the paused state, where a live countdown would lie.
    var frozen: String {
        let r = max(0, remaining)
        return String(format: "%02d:%02d", r / 60, r % 60)
    }
}

// MARK: - Pieces

/// The countdown itself: a native timer text while running (keeps ticking with
/// the app asleep), a frozen readout while paused.
@available(iOS 16.1, *)
struct PomodoroCountdown: View {
    let state: PomodoroAttributes.ContentState
    var size: CGFloat = 15
    var weight: Font.Weight = .semibold

    var body: some View {
        Group {
            if state.paused {
                Text(state.frozen)
            } else {
                Text(timerInterval: Date()...max(state.endsAt, Date().addingTimeInterval(1)),
                     countsDown: true)
            }
        }
        .font(.system(size: size, weight: weight).monospacedDigit())
        .multilineTextAlignment(.trailing)
    }
}

@available(iOS 16.1, *)
struct PomodoroBar: View {
    let state: PomodoroAttributes.ContentState
    let accent: Color

    var body: some View {
        Group {
            if state.paused {
                // A static bar — a live ProgressView would keep filling.
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.12))
                        Capsule().fill(accent.opacity(0.8))
                            .frame(width: geo.size.width * pausedFraction)
                    }
                }
            } else {
                ProgressView(timerInterval: state.startedAt...max(state.endsAt, state.startedAt.addingTimeInterval(1)),
                             countsDown: false) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .progressViewStyle(.linear)
                .tint(accent)
            }
        }
        .frame(height: 3)
    }

    private var pausedFraction: CGFloat {
        let total = state.endsAt.timeIntervalSince(state.startedAt)
        guard total > 0 else { return 0 }
        return min(1, max(0, CGFloat(1 - Double(state.remaining) / total)))
    }
}

// MARK: - Controls

/// Pause/resume, restart the phase, end the session. Interactive widgets are
/// iOS 17+; below that the activity is simply read-only.
@available(iOS 17.0, *)
struct PomodoroControls: View {
    let paused: Bool
    let accent: Color
    var compact = false

    private var side: CGFloat { compact ? 30 : 34 }
    private var glyph: CGFloat { compact ? 13 : 15 }

    var body: some View {
        HStack(spacing: compact ? 8 : 10) {
            control(paused ? "play.fill" : "pause.fill",
                    label: paused ? "Resume" : "Pause",
                    action: paused ? .resume : .pause,
                    filled: true)
            control("arrow.counterclockwise", label: "Restart", action: .restart)
            control("xmark", label: "End session", action: .stop)
        }
    }

    private func control(_ system: String, label: String, action: PomodoroAction, filled: Bool = false) -> some View {
        Button(intent: PomodoroControlIntent(action)) {
            Image(systemName: system)
                .font(.system(size: glyph, weight: .semibold))
                .foregroundStyle(filled ? Color.black.opacity(0.85) : .white.opacity(0.8))
                .frame(width: side, height: side)
                .background(
                    Circle().fill(filled ? accent.opacity(0.95) : Color.white.opacity(0.12))
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

// MARK: - Lock Screen / banner

@available(iOS 16.1, *)
struct PomodoroLockScreenView: View {
    let context: ActivityViewContext<PomodoroAttributes>

    var body: some View {
        let s = context.state
        let accent = s.accent(context.attributes)

        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Circle().fill(accent).frame(width: 6, height: 6)
                Text(context.attributes.subject.uppercased())
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(accent.opacity(0.9))
                    .lineLimit(1)
                Spacer(minLength: 6)
                Text(s.paused ? "PAUSED" : s.label)
                    .font(.system(size: 9, weight: .semibold))
                    .tracking(1.1)
                    .foregroundStyle(.white.opacity(0.4))
            }

            HStack(alignment: .firstTextBaseline) {
                Text(context.attributes.task.isEmpty ? context.attributes.subject : context.attributes.task)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.92))
                    .lineLimit(1)
                Spacer(minLength: 10)
                PomodoroCountdown(state: s, size: 26, weight: .semibold)
                    .foregroundStyle(.white)
                    .fixedSize()
            }

            PomodoroBar(state: s, accent: accent)

            HStack(alignment: .center) {
                if s.cycles > 0 {
                    Text("\(s.cycles) pomodoro\(s.cycles == 1 ? "" : "s") done")
                        .font(.system(size: 9.5, weight: .medium))
                        .foregroundStyle(.white.opacity(0.35))
                }
                Spacer(minLength: 8)
                if #available(iOS 17.0, *) {
                    PomodoroControls(paused: s.paused, accent: accent)
                }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .activityBackgroundTint(appBackground)
        .activitySystemActionForegroundColor(.white)
    }
}

// MARK: - Activity

@available(iOS 16.1, *)
struct PomodoroLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PomodoroAttributes.self) { context in
            PomodoroLockScreenView(context: context)
        } dynamicIsland: { context in
            let s = context.state
            let accent = s.accent(context.attributes)

            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    // Only the phase label lives here: the leading region is
                    // ~124pt wide, too narrow for a subject like "Western
                    // Philosophy" without truncating it. The subject goes in
                    // the bottom region, which spans the full island.
                    HStack(spacing: 6) {
                        Circle().fill(accent).frame(width: 6, height: 6)
                        Text(s.paused ? "PAUSED" : s.label)
                            .font(.system(size: 10, weight: .semibold))
                            .tracking(0.9)
                            .foregroundStyle(accent.opacity(0.9))
                            .lineLimit(1)
                    }
                    .frame(maxWidth: 96, alignment: .leading)
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    // An explicit width, not fixedSize(): a timer Text asks for
                    // the widest string it could ever show, which overflows the
                    // trailing region and blanks the whole expanded view. The
                    // trailing padding keeps the last digit off the island's
                    // rounded edge, which otherwise clips it.
                    PomodoroCountdown(state: s, size: 15)
                        .foregroundStyle(.white)
                        .frame(width: 66, alignment: .trailing)
                        .padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        // Full island width here, so the subject shows in full.
                        Text(context.attributes.subject)
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(0.6)
                            .foregroundStyle(accent.opacity(0.9))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        HStack(spacing: 8) {
                            Text(context.attributes.task.isEmpty ? context.attributes.subject : context.attributes.task)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(.white.opacity(0.85))
                                .lineLimit(1)
                            Spacer(minLength: 6)
                            if #available(iOS 17.0, *) {
                                PomodoroControls(paused: s.paused, accent: accent, compact: true)
                            }
                        }
                        PomodoroBar(state: s, accent: accent)
                    }
                    .padding(.top, 2)
                }
            } compactLeading: {
                Circle().fill(accent).frame(width: 7, height: 7)
            } compactTrailing: {
                PomodoroCountdown(state: s, size: 13, weight: .medium)
                    .foregroundStyle(accent)
                    .frame(width: 44, alignment: .trailing)
            } minimal: {
                Circle().fill(accent).frame(width: 7, height: 7)
            }
            .keylineTint(accent)
        }
    }
}
