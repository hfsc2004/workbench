#!/usr/bin/env bash
# intrinsic-aic adapter — Submit mode launcher.
#
# Guarded submission flow:
#   1) Preflight (aws, docker, auth, required inputs)
#   2) Build local submission image (aic-submission:dev)
#   3) Tag and push immutable version to ECR
#   4) Print final URI + digest

set -euo pipefail

: "${PSF_AIC_SUBMIT_TAG:?PSF_AIC_SUBMIT_TAG is required (e.g. v12)}"
: "${PSF_AIC_SUBMIT_TEAM:?PSF_AIC_SUBMIT_TEAM is required (e.g. pseudo-science-fiction)}"

SUBMISSION_DIR="${PSF_AIC_SUBMISSION_DIR:-$(pwd)}"
REGISTRY="973918476471.dkr.ecr.us-east-1.amazonaws.com"
REGION="${PSF_AIC_SUBMIT_REGION:-us-east-1}"
REPO="aic-team/${PSF_AIC_SUBMIT_TEAM}"
URI="${REGISTRY}/${REPO}:${PSF_AIC_SUBMIT_TAG}"

if ! command -v docker >/dev/null 2>&1; then
  echo "[intrinsic-aic/submit] docker not found" >&2
  exit 1
fi
if ! command -v aws >/dev/null 2>&1; then
  echo "[intrinsic-aic/submit] aws CLI not found (run aws configure first)" >&2
  exit 1
fi
if [[ ! -d "$SUBMISSION_DIR" ]]; then
  echo "[intrinsic-aic/submit] submission dir does not exist: $SUBMISSION_DIR" >&2
  exit 1
fi
if [[ ! -f "$SUBMISSION_DIR/docker/Dockerfile" ]]; then
  echo "[intrinsic-aic/submit] missing $SUBMISSION_DIR/docker/Dockerfile" >&2
  exit 1
fi

echo "[intrinsic-aic/submit] Preflight"
echo "                       submission dir = $SUBMISSION_DIR"
echo "                       team slug      = $PSF_AIC_SUBMIT_TEAM"
echo "                       tag            = $PSF_AIC_SUBMIT_TAG"
echo "                       target URI     = $URI"
echo

aws sts get-caller-identity >/dev/null
aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null

if aws ecr describe-images --repository-name "$REPO" --image-ids imageTag="$PSF_AIC_SUBMIT_TAG" --region "$REGION" >/dev/null 2>&1; then
  echo "[intrinsic-aic/submit] tag already exists in ECR (immutable tags): $URI" >&2
  echo "[intrinsic-aic/submit] choose a new PSF_AIC_SUBMIT_TAG and retry." >&2
  exit 1
fi

echo "[intrinsic-aic/submit] Building local image aic-submission:dev"
docker build -f "$SUBMISSION_DIR/docker/Dockerfile" -t aic-submission:dev "$SUBMISSION_DIR"

echo "[intrinsic-aic/submit] Logging into ECR"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$REGISTRY"

echo "[intrinsic-aic/submit] Pushing $URI"
docker tag aic-submission:dev "$URI"
docker push "$URI"

DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "$URI" 2>/dev/null || true)"
echo "[intrinsic-aic/submit] done"
echo "[intrinsic-aic/submit] uri:    $URI"
if [[ -n "$DIGEST" ]]; then
  echo "[intrinsic-aic/submit] digest: $DIGEST"
fi

