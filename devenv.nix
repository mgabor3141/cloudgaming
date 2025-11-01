{ pkgs, lib, config, inputs, ... }:

{
  # https://devenv.sh/basics/
  env.GREET = "devenv";

  # https://devenv.sh/packages/
  packages = [
    pkgs.git
    pkgs.docker
  ];

  dotenv.enable = true;

  # https://devenv.sh/languages/
  languages.javascript.enable = true;

  # https://devenv.sh/processes/
  # processes.dev.exec = "${lib.getExe pkgs.watchexec} -n -- ls -la";

  # https://devenv.sh/services/
  # services.postgres.enable = true;

  # https://devenv.sh/scripts/
  scripts = {
    hello = {
      exec = ''
        npm install
        echo hello from $GREET
      '';
    };
    cpanel = {
      description = "Start the control-panel development server";
      exec = "npm run dev -w control-panel";
    };
    hostinfo = {
      description = "Start the host-info development server";
      exec = "npm run dev -w host-info";
    };
    
    # Docker build scripts
    docker-build-control-panel = {
      description = "Build control-panel Docker image";
      exec = ''
        cd control-panel
        docker build -t control-panel:latest .
      '';
    };
    
    docker-build-host-info = {
      description = "Build host-info Docker image";
      exec = ''
        cd host-info
        docker build -t host-info:latest .
      '';
    };
    
    docker-build = {
      description = "Build all Docker images";
      exec = ''
        echo "Building control-panel..."
        cd control-panel && docker build -t control-panel:latest . && cd ..
        echo "Building host-info..."
        cd host-info && docker build -t host-info:latest . && cd ..
        echo "All images built successfully"
      '';
    };
    
    # Docker push scripts for GitHub Container Registry
    docker-push-control-panel = {
      description = "Build and push control-panel to GitHub Container Registry";
      exec = ''
        set -e
        if [ -z "$GITHUB_USER" ]; then
          echo "Error: GITHUB_USER environment variable is not set"
          echo "Example: export GITHUB_USER=yourusername"
          exit 1
        fi
        
        REPO_NAME="''${GITHUB_REPO:-cloudgaming}"
        IMAGE_NAME="ghcr.io/$GITHUB_USER/$REPO_NAME/control-panel"
        
        echo "Building control-panel..."
        cd control-panel
        docker build -t "$IMAGE_NAME:latest" -t "$IMAGE_NAME:$GITHUB_SHA" .
        
        echo "Pushing to $IMAGE_NAME..."
        docker push "$IMAGE_NAME:latest"
        if [ -n "$GITHUB_SHA" ]; then
          docker push "$IMAGE_NAME:$GITHUB_SHA"
        fi
        
        echo "Successfully pushed control-panel"
      '';
    };
    
    docker-push-host-info = {
      description = "Build and push host-info to GitHub Container Registry";
      exec = ''
        set -e
        if [ -z "$GITHUB_USER" ]; then
          echo "Error: GITHUB_USER environment variable is not set"
          echo "Example: export GITHUB_USER=yourusername"
          exit 1
        fi
        
        REPO_NAME="''${GITHUB_REPO:-cloudgaming}"
        IMAGE_NAME="ghcr.io/$GITHUB_USER/$REPO_NAME/host-info"
        
        echo "Building host-info..."
        cd host-info
        docker build -t "$IMAGE_NAME:latest" -t "$IMAGE_NAME:$GITHUB_SHA" .
        
        echo "Pushing to $IMAGE_NAME..."
        docker push "$IMAGE_NAME:latest"
        if [ -n "$GITHUB_SHA" ]; then
          docker push "$IMAGE_NAME:$GITHUB_SHA"
        fi
        
        echo "Successfully pushed host-info"
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
        devenv docker-push-control-panel
        devenv docker-push-host-info
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
  };

  # https://devenv.sh/basics/
  enterShell = ''
    hello         # Run scripts directly
    git --version # Use packages
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
