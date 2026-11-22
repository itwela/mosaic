import AppKit
import SwiftUI

// Colours from the Mosaic "Lit glass" tokens (figcraft-work/mosaic/glass2/tokens.css).
enum Glass {
    static let lead = Color(hex: 0x0B0A09)
    static let smoke = Color(hex: 0x0E0B09)
    static let sheet = Color(hex: 0x16110E)
    static let edge = Color(hex: 0x3A3028)
    static let cream = Color(hex: 0xF4EEE4)
    static let dim = Color(hex: 0xC4BAAB)
    static let faint = Color(hex: 0x5E564C)
    static let opal = (Color(hex: 0xF6F3EB), Color(hex: 0xB9B4A8))
    static let amber = (Color(hex: 0xFFCB62), Color(hex: 0xCC7410))
    static let ruby = (Color(hex: 0xF4606A), Color(hex: 0xA81E2A))
    static let teal = (Color(hex: 0x5AD3C8), Color(hex: 0x14787A))
    static let cobalt = (Color(hex: 0x79A6F8), Color(hex: 0x2450B0))
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

struct GlassTile: View {
    var colors: (Color, Color)
    var lit: Double
    var body: some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(LinearGradient(colors: [colors.0, colors.1], startPoint: .topLeading, endPoint: .bottomTrailing))
            .opacity(0.25 + 0.75 * lit)
    }
}

enum BubbleMode: Equatable {
    case ready, listening, handsFree, writing, nothing
    case meeting(started: Date)
}

final class BubbleModel: ObservableObject {
    @Published var mode: BubbleMode = .ready
    @Published var levels: [Double] = Array(repeating: 0.1, count: 14)
    @Published var hovering = false
    var onCancel: (() -> Void)?
    var onStop: (() -> Void)?
    var onStopMeeting: (() -> Void)?

    func push(level: Float) {
        var l = levels
        l.removeFirst()
        l.append(Double(level))
        levels = l
    }
}

struct Pill<Content: View>: View {
    var content: Content
    init(@ViewBuilder _ c: () -> Content) { content = c() }
    var body: some View {
        content
            .padding(.horizontal, 10)
            .frame(height: 36)
            .background(Capsule().fill(Glass.smoke))
            .overlay(Capsule().strokeBorder(Glass.edge, lineWidth: 1))
            .padding(2)
            .background(Capsule().fill(Glass.lead))
    }
}

struct VoiceTiles: View {
    var levels: [Double]
    var colors: (Color, Color)
    var width: CGFloat = 8
    var spacing: CGFloat = 3.5
    var body: some View {
        HStack(alignment: .center, spacing: spacing) {
            ForEach(levels.indices, id: \.self) { i in
                GlassTile(colors: colors, lit: levels[i])
                    .frame(width: width, height: 6 + 20 * levels[i])
            }
        }
        .frame(height: 28)
        .animation(.easeOut(duration: 0.08), value: levels)
    }
}

struct WritingTiles: View {
    @State private var phase = 0.0
    var body: some View {
        TimelineView(.animation) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            HStack(spacing: 3) {
                ForEach(0..<8, id: \.self) { i in
                    let d = abs(Double(i) - (sin(t * 2.4) * 0.5 + 0.5) * 7)
                    GlassTile(colors: Glass.amber, lit: max(0.2, 1 - d / 3.5)).frame(width: 8, height: 10)
                }
            }
        }
    }
}

struct BubbleView: View {
    @ObservedObject var model: BubbleModel
    var body: some View {
        Group {
            switch model.mode {
            case .ready:
                HStack(spacing: 2.5) {
                    if model.hovering {
                        Text("hold fn").font(.custom("DM Sans", size: 11)).foregroundStyle(Glass.dim)
                    } else {
                        ForEach(0..<6, id: \.self) { _ in GlassTile(colors: Glass.opal, lit: 0.35).frame(width: 5, height: 6) }
                    }
                }
                .padding(.horizontal, 10).frame(height: 14 + (model.hovering ? 8 : 0))
                .background(Capsule().fill(Glass.smoke)).overlay(Capsule().strokeBorder(Glass.edge, lineWidth: 1))
                .padding(2).background(Capsule().fill(Glass.lead))
            case .listening:
                Pill { VoiceTiles(levels: model.levels, colors: Glass.opal).padding(.horizontal, 8) }
            case .handsFree:
                Pill {
                    HStack(spacing: 10) {
                        Button { model.onCancel?() } label: {
                            Text("✕").font(.system(size: 12)).foregroundStyle(Glass.dim)
                                .frame(width: 24, height: 24).background(Circle().fill(Color(hex: 0x241C17)))
                        }.buttonStyle(.plain)
                        VoiceTiles(levels: Array(model.levels.suffix(13)), colors: Glass.amber, width: 9, spacing: 4)
                        Button { model.onStop?() } label: {
                            RoundedRectangle(cornerRadius: 1.5).fill(Glass.cream).frame(width: 8, height: 8)
                                .frame(width: 24, height: 24)
                                .background(Circle().fill(LinearGradient(colors: [Glass.ruby.0, Glass.ruby.1], startPoint: .topLeading, endPoint: .bottomTrailing)))
                        }.buttonStyle(.plain)
                    }
                }
            case .writing:
                Pill { WritingTiles().padding(.horizontal, 6) }
            case .nothing:
                Pill {
                    HStack(spacing: 10) {
                        GlassTile(colors: Glass.ruby, lit: 1).frame(width: 14, height: 14)
                        Text("Didn’t catch that").font(.custom("DM Sans", size: 13)).foregroundStyle(Glass.cream)
                    }.padding(.horizontal, 4)
                }
            case .meeting(let started):
                Pill {
                    HStack(spacing: 10) {
                        GlassTile(colors: Glass.ruby, lit: 1).frame(width: 14, height: 14)
                        TimelineView(.periodic(from: .now, by: 1)) { ctx in
                            let s = Int(ctx.date.timeIntervalSince(started))
                            Text("Taking notes · \(s / 60):\(String(format: "%02d", s % 60))")
                                .font(.custom("DM Sans", size: 13)).foregroundStyle(Glass.cream).monospacedDigit()
                        }
                        VoiceTiles(levels: Array(model.levels.suffix(5)), colors: Glass.opal, width: 6, spacing: 3)
                        Button { model.onStopMeeting?() } label: {
                            RoundedRectangle(cornerRadius: 1.5).fill(Glass.dim).frame(width: 8, height: 8)
                                .frame(width: 24, height: 24).background(Circle().fill(Color(hex: 0x241C17)))
                        }.buttonStyle(.plain)
                    }.padding(.horizontal, 4)
                }
            }
        }
        .onHover { model.hovering = $0 }
        .fixedSize()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
    }
}

/// A floating panel that never takes focus from the app you're typing in.
final class FloatingPanel: NSPanel {
    init(size: NSSize) {
        super.init(contentRect: NSRect(origin: .zero, size: size),
                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isFloatingPanel = true
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        backgroundColor = .clear
        isOpaque = false
        hasShadow = false
        hidesOnDeactivate = false
        becomesKeyOnlyIfNeeded = true
    }
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class Bubble {
    let model = BubbleModel()
    private let panel = FloatingPanel(size: NSSize(width: 320, height: 56))
    private var hideNothing: DispatchWorkItem?

    init() {
        panel.contentView = NSHostingView(rootView: BubbleView(model: model))
        place()
        panel.orderFrontRegardless()
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in self?.place() }
    }

    /// Bottom centre of the screen the mouse is on, just above the Dock.
    func place() {
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { NSMouseInRect(mouse, $0.frame, false) } ?? NSScreen.main
        guard let vf = screen?.visibleFrame else { return }
        panel.setFrameOrigin(NSPoint(x: vf.midX - panel.frame.width / 2, y: vf.minY + 10))
    }

    func set(_ mode: BubbleMode) {
        DispatchQueue.main.async { [self] in
            hideNothing?.cancel()
            if mode == .listening || mode == .handsFree { place(); model.levels = Array(repeating: 0.1, count: 14) }
            model.mode = mode
            if mode == .nothing {
                let w = DispatchWorkItem { [weak self] in self?.model.mode = .ready }
                hideNothing = w
                DispatchQueue.main.asyncAfter(deadline: .now() + 2, execute: w)
            }
        }
    }
}

// MARK: - Meeting cards (top right)

struct CardView: View {
    var tile: (Color, Color)
    var title: String
    var line: String
    var primary: String?
    var secondary: String?
    var link: String?
    var onPrimary: () -> Void = {}
    var onSecondary: () -> Void = {}
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            GlassTile(colors: tile, lit: 1).frame(width: 18, height: 18).padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.custom("DM Sans", size: 14).weight(.semibold)).foregroundStyle(Glass.cream)
                Text(line).font(.custom("DM Sans", size: 13)).foregroundStyle(Glass.dim).lineLimit(1)
                if let link {
                    Button(action: onPrimary) { Text(link).font(.custom("DM Sans", size: 13).weight(.medium)).foregroundStyle(Glass.cobalt.0) }
                        .buttonStyle(.plain).padding(.top, 4)
                }
                if primary != nil || secondary != nil {
                    HStack(spacing: 8) {
                        if let primary {
                            Button(action: onPrimary) {
                                Text(primary).font(.custom("DM Sans", size: 13).weight(.semibold)).foregroundStyle(Glass.lead)
                                    .padding(.horizontal, 14).frame(height: 30)
                                    .background(RoundedRectangle(cornerRadius: 4).fill(LinearGradient(colors: [Glass.opal.0, Glass.opal.1], startPoint: .topLeading, endPoint: .bottomTrailing)))
                            }.buttonStyle(.plain)
                        }
                        if let secondary {
                            Button(action: onSecondary) {
                                Text(secondary).font(.custom("DM Sans", size: 13)).foregroundStyle(Glass.dim)
                                    .padding(.horizontal, 14).frame(height: 30)
                                    .background(RoundedRectangle(cornerRadius: 4).fill(Color(hex: 0x1E1813)))
                                    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Glass.edge))
                            }.buttonStyle(.plain)
                        }
                    }.padding(.top, 10)
                }
            }
            Spacer(minLength: 0)
            Button(action: onSecondary) { Text("✕").font(.system(size: 12)).foregroundStyle(Glass.faint) }.buttonStyle(.plain)
        }
        .padding(18)
        .frame(width: 360, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 6).fill(Glass.sheet))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Glass.edge))
        .padding(3)
        .background(RoundedRectangle(cornerRadius: 9).fill(Glass.lead))
        .fixedSize()
    }
}

final class Card {
    private var panel: FloatingPanel?
    private var autoHide: DispatchWorkItem?

    func show(_ view: CardView, hideAfter: TimeInterval?) {
        DispatchQueue.main.async { [self] in
            close()
            let host = NSHostingView(rootView: view)
            let size = host.fittingSize
            let p = FloatingPanel(size: size)
            p.contentView = host
            let vf = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
            p.setFrameOrigin(NSPoint(x: vf.maxX - size.width - 16, y: vf.maxY - size.height - 12))
            p.orderFrontRegardless()
            panel = p
            if let hideAfter {
                let w = DispatchWorkItem { [weak self] in self?.close() }
                autoHide = w
                DispatchQueue.main.asyncAfter(deadline: .now() + hideAfter, execute: w)
            }
        }
    }

    func close() {
        autoHide?.cancel()
        panel?.orderOut(nil)
        panel = nil
    }
}
