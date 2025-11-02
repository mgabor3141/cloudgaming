{ pkgs, lib, config, inputs, ... }:

{
  # https://devenv.sh/basics/
  env.GREET = "cloudgaming";

  # https://devenv.sh/packages/
  packages = [
    pkgs.git
    pkgs.docker
    pkgs.python3Packages.pygobject3
    pkgs.gobject-introspection
  ];

  dotenv.enable = true;

  # https://devenv.sh/languages/
  languages.javascript.enable = true;
  languages.python = {
    enable = true;
    venv = {
      enable = true;
      requirements = ''
        requests>=2.31.0
        requests-unixsocket>=0.3.0
        dasbus>=1.7
      '';
    };
  };

  # https://devenv.sh/processes/
  # processes.dev.exec = "${lib.getExe pkgs.watchexec} -n -- ls -la";

  # https://devenv.sh/services/
  # services.postgres.enable = true;

  # https://devenv.sh/scripts/
  scripts = let
    # Define services list - add new services here to auto-generate scripts
    services = [ "control-panel" "host-info" "idle-inhibitor" ];
    
    # Helper function to create docker-push script for a service
    makeDockerPushScript = service: {
      description = "Build and push ${service} to GitHub Container Registry";
      exec = ''
        set -e
        if [ -z "$GITHUB_USER" ]; then
          echo "Error: GITHUB_USER environment variable is not set"
          echo "Example: export GITHUB_USER=yourusername"
          exit 1
        fi
        
        REPO_NAME="''${GITHUB_REPO:-cloudgaming}"
        IMAGE_NAME="ghcr.io/$GITHUB_USER/$REPO_NAME/${service}"
        
        # Try to get repository URL from git remote, fallback to constructed URL
        GITHUB_REPO_URL="''${GITHUB_REPO_URL:-}"
        if [ -z "$GITHUB_REPO_URL" ]; then
          GIT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "")
          if [ -n "$GIT_REMOTE" ]; then
            # Convert git remote URL to GitHub web URL and remove .git suffix
            GITHUB_REPO_URL=$(echo "$GIT_REMOTE" | sed -E 's|^git@github.com:(.+)$|https://github.com/\1|' | sed -E 's|^https://github.com/(.+)$|https://github.com/\1|' | sed 's|\.git$||')
          else
            # Fallback to constructed URL
            GITHUB_REPO_URL="https://github.com/$GITHUB_USER/$REPO_NAME"
          fi
        fi
        
        echo "Building and pushing ${service} for multiple architectures..."
        cd ${service}
        docker buildx build --platform linux/amd64,linux/arm64 --build-arg GITHUB_REPO_URL="$GITHUB_REPO_URL" -t "$IMAGE_NAME:dev" --push .
        
        echo "Successfully pushed ${service}"
      '';
    };
    
    # Helper function to create docker-build script for a service
    makeDockerBuildScript = service: {
      description = "Build ${service} Docker image";
      exec = ''
        cd ${service}
        docker buildx build -t ${service}:latest --load .
      '';
    };
    
    # Generate docker-build scripts for each service
    dockerBuildScripts = lib.genAttrs (map (s: "docker-build-${lib.strings.replaceStrings ["-"] ["_"] s}") services)
      (name: let service = lib.strings.replaceStrings ["docker-build-"] [""] (lib.strings.replaceStrings ["_"] ["-"] name); in
        makeDockerBuildScript service);
    
    # Generate docker-push scripts for each service  
    dockerPushScripts = lib.genAttrs (map (s: "docker-push-${lib.strings.replaceStrings ["-"] ["_"] s}") services)
      (name: let service = lib.strings.replaceStrings ["docker-push-"] [""] (lib.strings.replaceStrings ["_"] ["-"] name); in
        makeDockerPushScript service);
  in {
    cpanel = {
      description = "Start the control-panel development server";
      exec = "npm run dev -w control-panel";
    };
    hostinfo = {
      description = "Start the host-info development server";
      exec = "npm run dev -w host-info";
    };
    
    idle-inhibitor-dev = {
      description = "Run idle-inhibitor locally";
      exec = ''
        cd idle-inhibitor
        python3 inhibitor.py
      '';
    };
    
    docker-build = {
      description = "Build all Docker images";
      exec = ''
        ${lib.concatMapStringsSep "\n" (service: ''
          echo "Building ${service}..."
          cd ${service} && docker buildx build -t ${service}:latest --load . && cd ..
        '') services}
        echo "All images built successfully"
      '';
    };
    
    docker-push = {
      description = "Build and push all images to GitHub Container Registry";
      exec = ''
        set -e
        if [ -z "$GITHUB_USER" ]; then
          echo "Error: GITHUB_USER environment variable is not set"
          echo "Example: export GITHUB_USER=yourusername"
          exit 1
        fi
        
        echo "Building and pushing all images..."
        ${lib.concatMapStringsSep "\n" (service: "docker-push-${lib.strings.replaceStrings ["-"] ["_"] service}") services}
        echo "All images pushed successfully"
      '';
    };
    
    docker-login = {
      description = "Login to GitHub Container Registry (requires GITHUB_TOKEN)";
      exec = ''
        if [ -z "$GITHUB_TOKEN" ]; then
          echo "Error: GITHUB_TOKEN environment variable is not set"
          echo "You can create a token at: https://github.com/settings/tokens"
          echo "Required scope: write:packages"
          exit 1
        fi
        
        echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_USER" --password-stdin
        echo "Logged in to GitHub Container Registry"
      '';
    };
  } // dockerBuildScripts // dockerPushScripts;

  # https://devenv.sh/basics/
  enterShell = ''
    npm install
    ${pkgs.util-linuxMinimal}/bin/column -t -s = <<EOF
    ${lib.generators.toKeyValue {} (lib.mapAttrs (name: value: value.description) config.scripts)}
    EOF
    echo -e "\nHello from $GREET"
  '';

  # https://devenv.sh/tasks/
  # tasks = {
  #   "myproj:setup".exec = "mytool build";
  #   "devenv:enterShell".after = [ "myproj:setup" ];
  # };

  # https://devenv.sh/tests/
  enterTest = ''
    echo "Running tests"
    git --version | grep --color=auto "${pkgs.git.version}"
  '';

  # https://devenv.sh/git-hooks/
  # git-hooks.hooks.shellcheck.enable = true;

  # See full reference at https://devenv.sh/reference/options/
}
