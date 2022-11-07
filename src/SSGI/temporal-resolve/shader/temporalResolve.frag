// a basic shader to implement temporal resolving

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;

uniform sampler2D velocityTexture;
uniform sampler2D hitPositionsTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastDepthTexture;

uniform sampler2D worldNormalTexture;
uniform sampler2D lastWorldNormalTexture;

uniform float blend;
uniform float samples;
uniform vec2 invTexSize;

varying vec2 vUv;

uniform mat4 projectionMatrix;
uniform mat4 cameraMatrixWorld;
uniform mat4 prevViewMatrix;
uniform vec3 cameraPos;
uniform vec3 lastCameraPos;

#define FLOAT_EPSILON           0.00001
#define FLOAT_ONE_MINUS_EPSILON 0.9999
#define ALPHA_STEP              0.001

#include <packing>

// idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
vec3 transformColor(vec3 color) {
#ifdef logTransform
    return log(max(color, vec3(FLOAT_EPSILON)));
#else
    return color;
#endif
}

vec3 undoColorTransform(vec3 color) {
#ifdef logTransform
    return exp(color);
#else
    return color;
#endif
}

vec2 viewSpaceToScreenSpace(vec3 position) {
    vec4 projectedCoord = projectionMatrix * vec4(position, 1.0);
    projectedCoord.xy /= projectedCoord.w;
    // [-1, 1] --> [0, 1] (NDC to screen position)
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    return projectedCoord.xy;
}

vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, mat4 curMatrixWorld) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = inverse(projectionMatrix) * ndc;
    vec4 view = curMatrixWorld * (clip / clip.w);

    return view.xyz;
}

#define PLANE_DISTANCE  0.1
#define NORMAL_DISTANCE 10.0

bool planeDistanceDisocclusionCheck(vec3 worldPos, vec3 lastWorldPos, vec3 worldNormal) {
    vec3 toCurrent = worldPos - lastWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane > PLANE_DISTANCE;
}

bool normalsDisocclusionCheck(vec3 currentNormal, vec3 lastNormal) {
    return pow(abs(dot(currentNormal, lastNormal)), 2.0) > NORMAL_DISTANCE;
}

void getNeighborhoodAABB(sampler2D tex, vec2 uv, inout vec3 minNeighborColor, inout vec3 maxNeighborColor) {
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            if (x != 0 || y != 0) {
                vec2 offset = vec2(x, y) * invTexSize;
                vec2 neighborUv = uv + offset;

                vec4 neighborTexel = textureLod(tex, neighborUv, 0.0);

                vec3 col = transformColor(neighborTexel.rgb);

                minNeighborColor = min(col, minNeighborColor);
                maxNeighborColor = max(col, maxNeighborColor);
            }
        }
    }
}

bool validateReprojectedUV(vec2 reprojectedUv, float depth, vec3 worldPos, vec4 worldNormalTexel) {
    vec3 worldNormal = unpackRGBToNormal(worldNormalTexel.xyz);

    vec4 lastWorldNormalTexel = textureLod(lastWorldNormalTexture, reprojectedUv, 0.);
    vec3 lastWorldNormal = unpackRGBToNormal(lastWorldNormalTexel.xyz);

    if (!(all(greaterThanEqual(reprojectedUv, vec2(0.))) && all(lessThanEqual(reprojectedUv, vec2(1.))))) return false;
    if (normalsDisocclusionCheck(worldNormal, lastWorldNormal)) return false;

    // the reprojected UV coordinates are inside the view
    float lastDepth = unpackRGBAToDepth(textureLod(lastDepthTexture, reprojectedUv, 0.));
    vec3 lastWorldPos = screenSpaceToWorldSpace(reprojectedUv, lastDepth, inverse(prevViewMatrix));

    if (planeDistanceDisocclusionCheck(worldPos, lastWorldPos, worldNormal)) return false;

    float depthDiff = abs(depth - lastDepth);
    if (depthDiff > maxNeighborDepthDifference) return false;

    return true;
}

vec2 reprojectVelocity() {
    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);
    velocity.xy = unpackRGBATo2Half(velocity) * 2. - 1.;

    if (all(lessThan(abs(velocity.xy), invTexSize * 0.25))) {
        velocity.xy = vec2(0.);
    }

    return vUv - velocity.xy;
}

vec2 reprojectHitPoint(vec3 rayOrig, float rayLength, vec2 uv, float depth) {
    vec3 cameraRay = normalize(rayOrig - cameraPos);
    float cameraRayLength = distance(rayOrig, cameraPos);

    vec3 parallaxHitPoint = cameraPos + cameraRay * (cameraRayLength + rayLength);

    vec4 reprojectedParallaxHitPoint = prevViewMatrix * vec4(parallaxHitPoint, 1.0);
    vec2 hitPointUv = viewSpaceToScreenSpace(reprojectedParallaxHitPoint.xyz);

    return hitPointUv;
}

void main() {
    vec4 inputTexel = textureLod(inputTexture, vUv, 0.0);

    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);
    float depth = unpackRGBAToDepth(depthTexel);

    vec3 inputColor = transformColor(inputTexel.rgb);
    float alpha = 1.0;

    vec4 accumulatedTexel;
    vec3 accumulatedColor;

    vec3 worldPos = screenSpaceToWorldSpace(vUv, depth, cameraMatrixWorld);

    vec4 worldNormalTexel = textureLod(worldNormalTexture, vUv, 0.);
    float curvature = worldNormalTexel.a;

    vec2 reprojectedUv;
    float rayLength;
    if (curvature == 0.0 && (rayLength = textureLod(inputTexture, vUv, 0.).a) != 0.0) {
        reprojectedUv = reprojectHitPoint(worldPos, rayLength, vUv, depth);
    } else {
        reprojectedUv = reprojectVelocity();
    }

    bool isReprojectedUvValid = validateReprojectedUV(reprojectedUv, depth, worldPos, worldNormalTexel);

    if (isReprojectedUvValid) {
        accumulatedTexel = textureLod(accumulatedTexture, reprojectedUv, 0.0);

        alpha = accumulatedTexel.a;
        alpha = min(alpha, blend);
        accumulatedColor = transformColor(accumulatedTexel.rgb);

        alpha += ALPHA_STEP;

#ifdef neighborhoodClamping
        vec3 minNeighborColor = inputColor;
        vec3 maxNeighborColor = inputColor;
        getNeighborhoodAABB(inputTexture, vUv, minNeighborColor, maxNeighborColor);

        accumulatedColor = clamp(accumulatedColor, minNeighborColor, maxNeighborColor);

#endif
    } else {
        // gOutput = vec4(0., 1., 0., 1.);
        // gMoment = gOutput;
        // return;

        accumulatedColor = inputColor;
        alpha = 0.0;
    }

    vec3 outputColor = inputColor;

    float pixelSample = alpha / ALPHA_STEP + 1.0;
    float temporalResolveMix = 1. - 1. / pixelSample;
    temporalResolveMix = min(temporalResolveMix, blend);

    outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef useCustomComposeShader
    customComposeShader
#else
    gl_FragColor = vec4(undoColorTransform(outputColor), alpha);
#endif
}