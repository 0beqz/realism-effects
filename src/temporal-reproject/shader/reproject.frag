// #define VISUALIZE_DISOCCLUSIONS

vec2 dilatedUv, velocity;
vec3 worldNormal, worldPos, viewDir;
float depth, flatness, viewAngle, angleMix, rayLength = 0.0;
float roughness = -1.0;

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

// source:
// https://github.com/mrdoob/three.js/blob/342946c8392639028da439b6dc0597e58209c696/examples/js/shaders/SAOShader.js#L123
float getViewZ(const in float depth) {
#ifdef PERSPECTIVE_CAMERA
  return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
#else
  return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
#endif
}

vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, mat4 curMatrixWorld, const mat4 projMatrixInverse) {
  vec4 ndc = vec4((uv.x - 0.5) * 2.0, (uv.y - 0.5) * 2.0, (depth - 0.5) * 2.0, 1.0);

  vec4 clip = projMatrixInverse * ndc;
  vec4 view = curMatrixWorld * (clip / clip.w);

  return view.xyz;
}

vec2 viewSpaceToScreenSpace(const vec3 position, const mat4 projMatrix) {
  vec4 projectedCoord = projMatrix * vec4(position, 1.0);
  projectedCoord.xy /= projectedCoord.w;
  // [-1, 1] --> [0, 1] (NDC to screen position)
  projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

  return projectedCoord.xy;
}

#ifdef logTransform
// idea from:
// https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
void transformColor(inout vec3 color) { color = log(color + 1.); }

void undoColorTransform(inout vec3 color) { color = exp(color) - 1.; }
#else
#define transformColor
#define undoColorTransform
#endif

void getNeighborhoodAABB(const sampler2D tex, const int clampRadius, inout vec3 minNeighborColor, inout vec3 maxNeighborColor,
                         const bool isSpecular) {
  vec4 t1, t2;

  for (int x = -clampRadius; x <= clampRadius; x++) {
    for (int y = -clampRadius; y <= clampRadius; y++) {
      vec2 offset = vec2(x, y) * invTexSize;
      vec2 neighborUv = vUv + offset;

#if inputType == DIFFUSE_SPECULAR
      vec4 packedNeighborTexel = textureLod(inputTexture, neighborUv, 0.0);
      unpackTwoVec4(packedNeighborTexel, t1, t2);
      vec4 neighborTexel = isSpecular ? t2 : t1;
#else
      vec4 neighborTexel = textureLod(inputTexture, neighborUv, 0.0);
#endif

      minNeighborColor = min(neighborTexel.rgb, minNeighborColor);
      maxNeighborColor = max(neighborTexel.rgb, maxNeighborColor);
    }
  }
}

void clampNeighborhood(const sampler2D tex, inout vec3 color, vec3 inputColor, const int clampRadius, const bool isSpecular) {
  undoColorTransform(inputColor);
  vec3 minNeighborColor = inputColor;
  vec3 maxNeighborColor = inputColor;

  getNeighborhoodAABB(tex, clampRadius, minNeighborColor, maxNeighborColor, isSpecular);

  transformColor(minNeighborColor);
  transformColor(maxNeighborColor);

  color = clamp(color, minNeighborColor, maxNeighborColor);
}

void getVelocityNormalDepth(inout vec2 dilatedUv, out vec2 vel, out vec3 normal, out float depth) {
  vec2 centerUv = dilatedUv;

  vec4 velocityTexel = textureLod(velocityTexture, centerUv, 0.0);

  vel = velocityTexel.rg;
  normal = unpackNormal(velocityTexel.b);
  depth = velocityTexel.a;
}

#define PLANE_DISTANCE 10.
#define VELOCITY_DISTANCE 0.01
#define WORLD_DISTANCE 10.

float planeDistanceDisocclusionCheck(const vec3 worldPos, const vec3 lastWorldPos, const vec3 worldNormal, const float distFactor) {
  vec3 toCurrent = worldPos - lastWorldPos;
  float distToPlane = abs(dot(toCurrent, worldNormal));

  return distToPlane / PLANE_DISTANCE * distFactor;
}

float velocityDisocclusionCheck(const vec2 velocity, const vec2 lastVelocity, const float distFactor) {
  return length(velocity - lastVelocity) / VELOCITY_DISTANCE * distFactor;
}

float worldDistanceDisocclusionCheck(const vec3 worldPos, const vec3 lastWorldPos, const float distFactor) {
  return length(worldPos - lastWorldPos) / WORLD_DISTANCE * distFactor;
}

float validateReprojectedUV(const vec2 reprojectedUv, const vec3 worldPos, const vec3 worldNormal, const bool isHitPoint) {
  if (reprojectedUv.x > 1.0 || reprojectedUv.x < 0.0 || reprojectedUv.y > 1.0 || reprojectedUv.y < 0.0)
    return 0.;

  vec2 dilatedReprojectedUv = reprojectedUv;
  vec2 lastVelocity = vec2(0.0);
  vec3 lastWorldNormal = vec3(0.0);
  float lastDepth = 0.0;

  getVelocityNormalDepth(dilatedReprojectedUv, lastVelocity, lastWorldNormal, lastDepth);
  vec3 lastWorldPos = screenSpaceToWorldSpace(dilatedReprojectedUv, lastDepth, prevCameraMatrixWorld, prevProjectionMatrixInverse);

  vec3 lastViewPos = (prevViewMatrix * vec4(lastWorldPos, 1.0)).xyz;

  vec3 lastViewDir = normalize(lastViewPos);
  vec3 lastViewNormal = (prevViewMatrix * vec4(lastWorldNormal, 0.0)).xyz;

  // get the angle between the view direction and the normal
  float lastViewAngle = dot(-lastViewDir, lastViewNormal);

  // angleDiff will be higher, the more we try to reproject pixels from a steep
  // angle onto a surface with a low angle which results in undesired stretching
  angleMix = abs(lastViewAngle - viewAngle) * 25.;
  angleMix = mix(0., angleMix, sqrt(flatness));
  angleMix = min(angleMix, 1.);

  float viewZ = abs(getViewZ(depth));
  float distFactor = 1. + 1. / (viewZ + 1.0);

  float disoccl = 0.;

  disoccl += velocityDisocclusionCheck(velocity, lastVelocity, distFactor);
  disoccl += planeDistanceDisocclusionCheck(worldPos, lastWorldPos, worldNormal, distFactor);
  disoccl += worldDistanceDisocclusionCheck(worldPos, lastWorldPos, distFactor);

  disoccl = min(disoccl / 3., 1.);

  return 1. - disoccl;
}

vec2 reprojectHitPoint(const vec3 rayOrig, const float rayLength) {
#ifndef PERSPECTIVE_CAMERA
  return vec2(-1.);
#endif

  if (rayLength > 10.0e3) {
    return vec2(-1.);
  }

  vec3 cameraRay = rayOrig - cameraPos;

  cameraRay = normalize(cameraRay);

  vec3 parallaxHitPoint = cameraPos + cameraRay * rayLength;

  vec4 reprojectedHitPoint = prevProjectionMatrix * prevViewMatrix * vec4(parallaxHitPoint, 1.0);

  reprojectedHitPoint.xyz /= reprojectedHitPoint.w;
  reprojectedHitPoint.xy = reprojectedHitPoint.xy * 0.5 + 0.5;

  return reprojectedHitPoint.xy;
}

vec3 getReprojectedUV(const bool doReprojectSpecular, const float depth, const vec3 worldPos, const vec3 worldNormal) {
  // hit point reprojection
  if (doReprojectSpecular) {
    vec2 reprojectedUv = reprojectHitPoint(worldPos, rayLength);

    float confidence = validateReprojectedUV(reprojectedUv, worldPos, worldNormal, true);
    return vec3(reprojectedUv, confidence);
  }

  // reprojection using motion vectors
  vec2 reprojectedUv = vUv - velocity;

  float confidence = validateReprojectedUV(reprojectedUv, worldPos, worldNormal, false);
  return vec3(reprojectedUv, confidence);
}

// source: https://www.shadertoy.com/view/styXDh
vec4 BiCubicCatmullRom5Tap(sampler2D tex, vec2 P) {
  vec2 Weight[3];
  vec2 Sample[3];

  vec2 UV = P / invTexSize;
  vec2 tc = floor(UV - 0.5) + 0.5;
  vec2 f = UV - tc;
  vec2 f2 = f * f;
  vec2 f3 = f2 * f;

  vec2 w0 = f2 - 0.5 * (f3 + f);
  vec2 w1 = 1.5 * f3 - 2.5 * f2 + vec2(1.);
  vec2 w3 = 0.5 * (f3 - f2);
  vec2 w2 = vec2(1.) - w0 - w1 - w3;

  Weight[0] = w0;
  Weight[1] = w1 + w2;
  Weight[2] = w3;

  Sample[0] = tc - vec2(1.);
  Sample[1] = tc + w2 / Weight[1];
  Sample[2] = tc + vec2(2.);

  Sample[0] *= invTexSize;
  Sample[1] *= invTexSize;
  Sample[2] *= invTexSize;

  float sampleWeight[5];
  sampleWeight[0] = Weight[1].x * Weight[0].y;
  sampleWeight[1] = Weight[0].x * Weight[1].y;
  sampleWeight[2] = Weight[1].x * Weight[1].y;
  sampleWeight[3] = Weight[2].x * Weight[1].y;
  sampleWeight[4] = Weight[1].x * Weight[2].y;

  vec4 Ct = texture(tex, vec2(Sample[1].x, Sample[0].y)) * sampleWeight[0];
  vec4 Cl = texture(tex, vec2(Sample[0].x, Sample[1].y)) * sampleWeight[1];
  vec4 Cc = texture(tex, vec2(Sample[1].x, Sample[1].y)) * sampleWeight[2];
  vec4 Cr = texture(tex, vec2(Sample[2].x, Sample[1].y)) * sampleWeight[3];
  vec4 Cb = texture(tex, vec2(Sample[1].x, Sample[2].y)) * sampleWeight[4];

  float WeightMultiplier = 1. / (sampleWeight[0] + sampleWeight[1] + sampleWeight[2] + sampleWeight[3] + sampleWeight[4]);

  return max((Ct + Cl + Cc + Cr + Cb) * WeightMultiplier, vec4(0.));
}

// source:
// http://rodolphe-vaillant.fr/entry/118/curvature-of-a-distance-field-implicit-surface
float getFlatness(vec3 worldPosition, vec3 worldNormal) {
  vec3 gw = fwidth(worldPosition);
  vec3 pw = fwidth(worldNormal);

  float wfcurvature = length(gw) / length(pw);
  wfcurvature = smoothstep(0.0, 30., wfcurvature);

  return clamp(wfcurvature, 0., 1.);
}

vec4 sampleReprojectedTexture(const sampler2D tex, const vec2 reprojectedUv) { return BiCubicCatmullRom5Tap(tex, reprojectedUv); }
