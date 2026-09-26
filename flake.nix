{
  description = "Yachigravity development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    llm-agents.url = "github:numtide/llm-agents.nix";
  };

  outputs =
    inputs@{
      flake-parts,
      ...
    }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      perSystem =
        { pkgs, inputs', ... }:
        let
          bun = pkgs.bun.overrideAttrs (_: {
            version = "1.4.2";
            src = pkgs.fetchurl {
              url =
                {
                  "aarch64-darwin" =
                    "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-darwin-aarch64.zip";
                  "aarch64-linux" =
                    "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-aarch64.zip";
                  "x86_64-linux" =
                    "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64-baseline.zip";
                }
                .${pkgs.stdenv.hostPlatform.system};
              hash =
                {
                  "aarch64-darwin" = "sha256-kJh6OhbX21VtiGrD1VHnttPt8KHPQ6yu1iLoZ2vh0S8=";
                  "aarch64-linux" = "sha256-VDKLvC2cjgyfiSxUTWbFeoO4QTnjSQnl7oF1jxrI/ac=";
                  "x86_64-linux" = "sha256-xngEDxT+BEDrg503y9DOTAUaMtpygGrJfeamqra/co8=";
                }
                .${pkgs.stdenv.hostPlatform.system};
            };
          });
        in
        {
          devShells.default = pkgs.mkShell {
            packages = [
              bun
              inputs'.llm-agents.packages.antigravity-cli
            ];
            shellHook = ''
              bun --version > .bun-version
            '';
          };
        };
    };
}
