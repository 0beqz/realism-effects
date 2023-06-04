// #define VISUALIZE_DISOCCLUSIONS

vec2 dilatedUv;
int texIndex;
vec2 velocity;
vec3 worldNormal;
float depth;
float flatness;
vec3 debugVec3;
float viewAngle;

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

bool doColorTransform[textureCount];

#ifdef logTransform
// idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
void transformColor(inout vec3 color) {
    if (!doColorTransform[texIndex]) return;
    float lum = luminance(color);

    float diff = min(1.0, lum - 0.99);
    if (diff > 0.0) {
        color = vec3(diff * 0.1);
        return;
    }

    color = dot(color, color) > 0.00001 ? log(color) : vec3(0.00001);
}

void undoColorTransform(inout vec3 color) {
    if (!doColorTransform[texIndex]) return;

    color = exp(color);
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

#define DEPTH_DISTANCE    1.0
#define NORMAL_DISTANCE   0.05
#define VELOCITY_DISTANCE 0.005

bool planeDistanceDisocclusionCheck(const vec3 worldPos, const vec3 lastWorldPos, const vec3 worldNormal, const float distFactor) {
    if (abs(dot(worldNormal, worldPos)) == 0.0) return false;

    vec3 toCurrent = worldPos - lastWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane > DEPTH_DISTANCE * distFactor;
}

bool normalsDisocclusionCheck(vec3 worldNormal, vec3 lastWorldNormal, const float distFactor) {
    return 1. - dot(worldNormal, lastWorldNormal) > NORMAL_DISTANCE * distFactor;
}

bool velocityDisocclusionCheck(const vec2 velocity, const vec2 lastVelocity, const float distFactor) {
    return length(velocity - lastVelocity) > VELOCITY_DISTANCE * distFactor;
}

bool validateReprojectedUV(const vec2 reprojectedUv, const vec3 worldPos, const vec3 worldNormal, const bool isHitPoint) {
    if (reprojectedUv.x > 1.0 || reprojectedUv.x < 0.0 || reprojectedUv.y > 1.0 || reprojectedUv.y < 0.0) return false;

    // ! todo: make hit point check more robust but less restrictive
    // if (isHitPoint) return true;

    vec2 dilatedReprojectedUv = reprojectedUv;
    vec2 lastVelocity = vec2(0.0);
    vec3 lastWorldNormal = vec3(0.0);
    float lastDepth = 0.0;

    getVelocityNormalDepth(dilatedReprojectedUv, lastVelocity, lastWorldNormal, lastDepth);

    float viewZ = abs(getViewZ(depth));
    float distFactor = 1. + 1. / (viewZ + 1.0);
    distFactor *= viewAngle * viewAngle;
    distFactor *= 2.;

    if (velocityDisocclusionCheck(velocity, lastVelocity, distFactor)) return false;

    if (normalsDisocclusionCheck(worldNormal, lastWorldNormal, distFactor)) return false;

    vec3 lastWorldPos = screenSpaceToWorldSpace(dilatedReprojectedUv, lastDepth, prevCameraMatrixWorld, prevProjectionMatrixInverse);

    if (planeDistanceDisocclusionCheck(worldPos, lastWorldPos, worldNormal, distFactor))
        return false;

    return true;
}

vec3 worldSpaceToViewSpace(vec3 worldPosition) {
    vec4 viewPosition = viewMatrix * vec4(worldPosition, 1.0);
    return viewPosition.xyz / viewPosition.w;
}

vec3 world_to_prev_view(vec3 world_position, float w) {
    vec4 prev_view_position = prevViewMatrix * vec4(world_position, w);
    return prev_view_position.xyz / (prev_view_position.w == 0.0 ? 1.0 : prev_view_position.w);
}

vec3 view_to_ss(vec3 view_position, float w) {
    vec4 projectedCoord = projectionMatrix * vec4(view_position, w);
    projectedCoord.xy /= projectedCoord.w;
    // [-1, 1] --> [0, 1] (NDC to screen position)
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    return projectedCoord.xyz;
}

vec3 proj_point_in_plane(vec3 p, vec3 v0, vec3 n, out float d) {
    d = dot(n, p - v0);
    return p - (n * d);
}

vec3 ss_to_view(const vec3 uvd, float w) {
    vec3 worldSpace = screenSpaceToWorldSpace(uvd.xy, uvd.z, cameraMatrixWorld, projectionMatrixInverse);

    vec3 viewSpace = worldSpaceToViewSpace(worldSpace);

    return viewSpace;
}

vec3 find_reflection_incident_point(vec3 p0, vec3 p1, vec3 v0, vec3 n) {
    float d0 = 0.0;
    float d1 = 0.0;
    vec3 proj_p0 = proj_point_in_plane(p0, v0, n, d0);
    vec3 proj_p1 = proj_point_in_plane(p1, v0, n, d1);

    if (d1 < d0)
        return (proj_p0 - proj_p1) * d1 / (d0 + d1) + proj_p1;
    else
        return (proj_p1 - proj_p0) * d0 / (d0 + d1) + proj_p0;
}

vec2 find_previous_reflection_position(
    vec3 ss_pos, vec3 ss_ray,
    vec2 surface_motion_vector, vec2 reflection_motion_vector,
    vec3 world_normal) {
    vec3 ss_p0 = vec3(0.0, 0.0, 0.0);
    ss_p0.xy = ss_pos.xy - surface_motion_vector;
    ss_p0.z = texture(velocityTexture, ss_p0.xy).a;

    vec3 ss_p1 = vec3(0.0, 0.0, 0.0);
    ss_p1.xy = ss_ray.xy - reflection_motion_vector;
    ss_p1.z = texture(velocityTexture, ss_p1.xy).a;

    vec3 view_n = normalize(world_to_prev_view(world_normal, 0.0));
    vec3 view_p0 = vec3(0.0, 0.0, 0.0);
    vec3 view_v0 = ss_to_view(ss_p0, 1.0);
    vec3 view_p1 = ss_to_view(ss_p1, 1.0);

    vec3 view_intersection =
        find_reflection_incident_point(view_p0, view_p1, view_v0, view_n);
    vec2 ss_intersection = viewSpaceToScreenSpace(view_intersection, projectionMatrix);
    // debugVec3 = ss_intersection.xyy;

    return ss_intersection.xy;
}

vec2 reprojectHitPoint(const vec3 rayOrig, const float rayLength) {
    if (rayLength > 10.0e3) {
        vec2 velocity = textureLod(velocityTexture, vUv, 0.).xy;

        return vUv - velocity;
    }

    vec3 cameraRay = rayOrig - cameraPos;

    float cameraRayLength = length(cameraRay);

    cameraRay = normalize(cameraRay);

    vec3 parallaxHitPoint = cameraPos + cameraRay * (cameraRayLength + rayLength);

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
    vec4 blocky = SampleTextureCatmullRom(tex, reprojectedUv, 1. / invTexSize);

    return blocky;
}
