// swift-tools-version: 6.2
// Mac-only "ears" for Mosaic Voice: fn key, mic, Apple's on-device speech, system audio,
// meeting detection and the bubble. Cleanup and summaries happen in Mosaic's Rust core.
import PackageDescription

let package = Package(
    name: "MosaicVoice",
    platforms: [.macOS(.v26)],
    products: [.executable(name: "mosaic-voice", targets: ["MosaicVoice"])],
    targets: [
        .executableTarget(
            name: "MosaicVoice",
            swiftSettings: [.swiftLanguageMode(.v5)],
            // Embedded Info.plist: without the usage descriptions macOS never asks for the mic
            // and silently hands the helper silence.
            linkerSettings: [.unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", "/Users/itwelaibomu/Desktop/Code/mosaic/src-tauri/voice/Info.plist"])]
        ),
    ]
)
