fn main() {
    // Mac: build the Swift voice helper and place it where Tauri bundles sidecars.
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=voice/Sources");
        println!("cargo:rerun-if-changed=voice/Package.swift");
        let ok = std::process::Command::new("swift")
            .args(["build", "-c", "release", "--package-path", "voice"])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(ok, "building the mosaic-voice helper failed");
        std::fs::create_dir_all("binaries").unwrap();
        let target = std::env::var("TARGET").unwrap();
        std::fs::copy("voice/.build/release/mosaic-voice", format!("binaries/mosaic-voice-{target}")).unwrap();
    }
    tauri_build::build()
}
