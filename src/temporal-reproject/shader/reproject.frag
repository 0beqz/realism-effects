// #define VISUALIZE_DISOCCLUSIONS

vec2 dilatedUv;
int texIndex;
vec2 velocity;
vec3 worldNormal;
float depth;
float flatness;
vec3 debugVec3;
float viewAngle;
float angleMix;
float roughness = 0.0;

#define luminance(a) dot(vec3(0.2125, 0.7154, 0.0721), a)

float getViewZ(const float depth) {
    return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
}

vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, mat4 curMatrixWorld, const mat4 projMatrixInverse) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

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

// source: https://knarkowicz.wordpress.com/2014/04/16/octahedron-normal-vector-encoding/
vec2 OctWrap(vec2 v) {
    vec2 w = 1.0 - abs(v.yx);
    if (v.x < 0.0) w.x = -w.x;
    if (v.y < 0.0) w.y = -w.y;
    return w;
}

// source: https://knarkowicz.wordpress.com/2014/04/16/octahedron-normal-vector-encoding/
vec3 decodeOctWrap(vec2 f) {
    f = f * 2.0 - 1.0;

    // https://twitter.com/Stubbesaurus/status/937994790553227264
    vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    float t = max(-n.z, 0.0);
    n.x += n.x >= 0.0 ? -t : t;
    n.y += n.y >= 0.0 ? -t : t;
    return normalize(n);
}

vec3 unpackNormal(float packedNormal) {
    return decodeOctWrap(unpackHalf2x16(floatBitsToUint(packedNormal)));
}

#ifdef logTransform
// idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
void transformColor(inout vec3 color) {
    color = log(color + 1.);
}

void undoColorTransform(inout vec3 color) {
    color = exp(color) - 1.;
}
#else
    #define transformColor
    #define undoColorTransform
#endif

void getNeighborhoodAABB(const sampler2D tex, const int clampRadius, inout vec3 minNeighborColor, inout vec3 maxNeighborColor) {
    for (int x = -clampRadius; x <= clampRadius; x++) {
        for (int y = -clampRadius; y <= clampRadius; y++) {
            if (x != 0 || y != 0) {
                vec2 offset = vec2(x, y) * invTexSize;
                vec2 neighborUv = vUv + offset;

                vec4 neighborTexel = textureLod(tex, neighborUv, 0.0);
                transformColor(neighborTexel.rgb);

                minNeighborColor = min(neighborTexel.rgb, minNeighborColor);
                maxNeighborColor = max(neighborTexel.rgb, maxNeighborColor);
            }
        }
    }
}

void clampNeighborhood(const sampler2D tex, inout vec3 color, const vec3 inputColor, const int clampRadius) {
    vec3 minNeighborColor = inputColor;
    vec3 maxNeighborColor = inputColor;

    getNeighborhoodAABB(tex, clampRadius, minNeighborColor, maxNeighborColor);

    color = clamp(color, minNeighborColor, maxNeighborColor);
}

void getVelocityNormalDepth(inout vec2 dilatedUv, out vec2 vel, out vec3 normal, out float depth) {
    vec2 centerUv = dilatedUv;

#ifdef dilation
    float closestDepth = 0.0;
    vec4 closestVelocityTexel = vec4(0.0);

    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            vec2 offset = vec2(x, y) * invTexSize;
            vec2 neighborUv = centerUv + offset;

            vec4 velocityTexel = textureLod(velocityTexture, neighborUv, 0.0);
            float neighborDepth = velocityTexel.a;

            if (x == 0 && y == 0) {
                vel = velocityTexel.rg;
            }

            if (neighborDepth > closestDepth) {
                closestDepth = neighborDepth;
                closestVelocityTexel = velocityTexel;

                dilatedUv = neighborUv;
            }
        }
    }

    normal = unpackNormal(closestVelocityTexel.b);
    depth = closestDepth;

#else
    vec4 velocityTexel = textureLod(velocityTexture, centerUv, 0.0);

    vel = velocityTexel.rg;
    normal = unpackNormal(velocityTexel.b);
    depth = velocityTexel.a;
#endif
}

#define PLANE_DISTANCE    1.0
#define NORMAL_DISTANCE   0.1
#define VELOCITY_DISTANCE 0.005

bool planeDistanceDisocclusionCheck(const vec3 worldPos, const vec3 lastWorldPos, const vec3 worldNormal, const float distFactor) {
    if (abs(dot(worldNormal, worldPos)) == 0.0) return false;

    vec3 toCurrent = worldPos - lastWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane > PLANE_DISTANCE * distFactor;
}

bool normalsDisocclusionCheck(vec3 worldNormal, vec3 lastWorldNormal, const float distFactor) {
    return pow(abs(dot(worldNormal, lastWorldNormal)), 2.) < NORMAL_DISTANCE * distFactor;
}

bool velocityDisocclusionCheck(const vec2 velocity, const vec2 lastVelocity, const float distFactor) {
    return length(velocity - lastVelocity) > VELOCITY_DISTANCE * distFactor;
}

bool validateReprojectedUV(const vec2 reprojectedUv, const vec3 worldPos, const vec3 worldNormal, const bool isHitPoint) {
    return false;

    if (reprojectedUv.x > 1.0 || reprojectedUv.x < 0.0 || reprojectedUv.y > 1.0 || reprojectedUv.y < 0.0) return false;

    vec2 dilatedReprojectedUv = reprojectedUv;
    vec2 lastVelocity = vec2(0.0);
    vec3 lastWorldNormal = vec3(0.0);
    float lastDepth = 0.0;

    getVelocityNormalDepth(dilatedReprojectedUv, lastVelocity, lastWorldNormal, lastDepth);
    vec3 lastWorldPos = screenSpaceToWorldSpace(dilatedReprojectedUv, lastDepth, prevCameraMatrixWorld, prevProjectionMatrixInverse);

    vec3 lastViewPos = (viewMatrix * vec4(lastWorldPos, 1.0)).xyz;

    vec3 lastViewDir = normalize(lastViewPos);
    vec3 lastViewNormal = (viewMatrix * vec4(lastWorldNormal, 0.0)).xyz;

    // get the angle between the view direction and the normal
    float lastViewAngle = dot(-lastViewDir, lastViewNormal);

    // angleDiff will be higher, the more we try to reproject pixels from a steep angle onto a surface with a low angle
    // which results in undesired stretching
    float angleDiff = max(0., lastViewAngle - viewAngle);
    angleMix = min(1., 4. * angleDiff);

    float viewZ = abs(getViewZ(depth));
    float distFactor = 1. + 1. / (viewZ + 1.0);

    //! todo: take view angle into account

    if (velocityDisocclusionCheck(velocity, lastVelocity, distFactor)) return false;

    // ! todo: investigate normal disocclusion check
    // if (normalsDisocclusionCheck(worldNormal, lastWorldNormal, distFactor)) return false;

    if (planeDistanceDisocclusionCheck(worldPos, lastWorldPos, worldNormal, distFactor))
        return false;

    return true;
}

vec2 reprojectHitPoint(const vec3 rayOrig, const float rayLength) {
    // ! todo: investigate using motion reprojection for reflections when there is no
    // camera position change (only rotation change) as it barely causes any smearing for reflections

    if (roughness > 0.4 || rayLength > 10.0e3) {
        return vUv - velocity;
    }

    vec3 cameraRay = rayOrig - cameraPos;

    cameraRay = normalize(cameraRay);

    vec3 parallaxHitPoint = cameraPos + cameraRay * rayLength;

    vec4 reprojectedHitPoint = prevProjectionMatrix * prevViewMatrix * vec4(parallaxHitPoint, 1.0);

    reprojectedHitPoint.xyz /= reprojectedHitPoint.w;
    reprojectedHitPoint.xy = reprojectedHitPoint.xy * 0.5 + 0.5;

    return reprojectedHitPoint.xy;
}

vec2 getReprojectedUV(const float depth, const vec3 worldPos, const vec3 worldNormal, const float rayLength) {
    // hit point reprojection
    if (rayLength != 0.0) {
        vec2 reprojectedUv = reprojectHitPoint(worldPos, rayLength);

        if (validateReprojectedUV(reprojectedUv, worldPos, worldNormal, true)) {
            return reprojectedUv;
        }

        return vec2(-1.);
    }

    // reprojection using motion vectors
    vec2 reprojectedUv = vUv - velocity;

    if (validateReprojectedUV(reprojectedUv, worldPos, worldNormal, false)) {
        return reprojectedUv;
    }

    // invalid reprojection
    return vec2(-1.);
}

vec4 SampleTextureCatmullRom(const sampler2D tex, const vec2 uv, const vec2 texSize) {
    // We're going to sample a a 4x4 grid of texels surrounding the target UV coordinate. We'll do this by rounding
    // down the sample location to get the exact center of our "starting" texel. The starting texel will be at
    // location [1, 1] in the grid, where [0, 0] is the top left corner.
    vec2 samplePos = uv * texSize;
    vec2 texPos1 = floor(samplePos - 0.5f) + 0.5f;

    // Compute the fractional offset from our starting texel to our original sample location, which we'll
    // feed into the Catmull-Rom spline function to get our filter weights.
    vec2 f = samplePos - texPos1;

    // Compute the Catmull-Rom weights using the fractional offset that we calculated earlier.
    // These equations are pre-expanded based on our knowledge of where the texels will be located,
    // which lets us avoid having to evaluate a piece-wise function.
    vec2 w0 = f * (-0.5f + f * (1.0f - 0.5f * f));
    vec2 w1 = 1.0f + f * f * (-2.5f + 1.5f * f);
    vec2 w2 = f * (0.5f + f * (2.0f - 1.5f * f));
    vec2 w3 = f * f * (-0.5f + 0.5f * f);

    // Work out weighting factors and sampling offsets that will let us use bilinear filtering to
    // simultaneously evaluate the middle 2 samples from the 4x4 grid.
    vec2 w12 = w1 + w2;
    vec2 offset12 = w2 / (w1 + w2);

    // Compute the final UV coordinates we'll use for sampling the texture
    vec2 texPos0 = texPos1 - 1.;
    vec2 texPos3 = texPos1 + 2.;
    vec2 texPos12 = texPos1 + offset12;

    texPos0 /= texSize;
    texPos3 /= texSize;
    texPos12 /= texSize;

    vec4 result = vec4(0.0);
    result += textureLod(tex, vec2(texPos0.x, texPos0.y), 0.0f) * w0.x * w0.y;
    result += textureLod(tex, vec2(texPos12.x, texPos0.y), 0.0f) * w12.x * w0.y;
    result += textureLod(tex, vec2(texPos3.x, texPos0.y), 0.0f) * w3.x * w0.y;
    result += textureLod(tex, vec2(texPos0.x, texPos12.y), 0.0f) * w0.x * w12.y;
    result += textureLod(tex, vec2(texPos12.x, texPos12.y), 0.0f) * w12.x * w12.y;
    result += textureLod(tex, vec2(texPos3.x, texPos12.y), 0.0f) * w3.x * w12.y;
    result += textureLod(tex, vec2(texPos0.x, texPos3.y), 0.0f) * w0.x * w3.y;
    result += textureLod(tex, vec2(texPos12.x, texPos3.y), 0.0f) * w12.x * w3.y;
    result += textureLod(tex, vec2(texPos3.x, texPos3.y), 0.0f) * w3.x * w3.y;

    result = max(result, vec4(0.));

    return result;
}

// source: http://rodolphe-vaillant.fr/entry/118/curvature-of-a-distance-field-implicit-surface
float getFlatness(vec3 g, vec3 rp) {
    vec3 gw = fwidth(g);
    vec3 pw = fwidth(rp);

    float wfcurvature = length(gw) / length(pw);
    wfcurvature = smoothstep(0.0, 30., wfcurvature);

    return clamp(wfcurvature, 0., 1.);
}

// source: https://www.shadertoy.com/view/stSfW1
vec2 sampleBlocky(vec2 p) {
    p /= invTexSize;
    vec2 seam = floor(p + 0.5);
    p = seam + clamp((p - seam) / fwidth(p), -0.5, 0.5);
    return p * invTexSize;
}

vec4 sampleReprojectedTexture(const sampler2D tex, const vec2 reprojectedUv) {
    // ! todo: investigate using sampleBlocky
    vec4 blocky = SampleTextureCatmullRom(tex, sampleBlocky(reprojectedUv), 1. / invTexSize);

    return blocky;
}
