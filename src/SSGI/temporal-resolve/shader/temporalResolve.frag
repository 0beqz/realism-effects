// a basic shader to implement temporal resolving

uniform sampler2D inputTexture;
uniform sampler2D accumulatedTexture;

uniform sampler2D velocityTexture;
uniform sampler2D hitPositionsTexture;

uniform sampler2D depthTexture;
uniform sampler2D lastDepthTexture;

uniform sampler2D normalTexture;
uniform sampler2D lastNormalTexture;

uniform float blend;
uniform bool constantBlend;
uniform vec2 invTexSize;

varying vec2 vUv;

uniform mat4 projectionMatrix;
uniform mat4 projectionMatrixInverse;
uniform mat4 cameraMatrixWorld;
uniform mat4 _viewMatrix;
uniform mat4 prevViewMatrix;
uniform mat4 prevCameraMatrixWorld;
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

vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, mat4 curMatrixWorld) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);

    vec4 clip = projectionMatrixInverse * ndc;
    vec4 view = curMatrixWorld * (clip / clip.w);

    return view.xyz;
}

void getNeighborhoodAABB(sampler2D tex, vec2 uv, inout vec3 minNeighborColor, inout vec3 maxNeighborColor) {
    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            if (x != 0 || y != 0) {
                vec2 offset = vec2(x, y) * invTexSize;
                vec2 neighborUv = uv + offset;

                vec4 neighborTexel = textureLod(tex, neighborUv, 0.0);

                vec3 col = neighborTexel.rgb;

#ifdef logTransform
                col = transformColor(col);
#endif

                minNeighborColor = min(col, minNeighborColor);
                maxNeighborColor = max(col, maxNeighborColor);
            }
        }
    }
}

bool planeDistanceDisocclusionCheck(vec3 worldPos, vec3 lastWorldPos, vec3 worldNormal) {
    vec3 toCurrent = worldPos - lastWorldPos;
    float distToPlane = abs(dot(toCurrent, worldNormal));

    return distToPlane > depthDistance;
}

bool normalsDisocclusionCheck(vec3 currentNormal, vec3 lastNormal) {
    return pow(abs(dot(currentNormal, lastNormal)), 2.0) > normalDistance;
}

bool validateReprojectedUV(vec2 reprojectedUv, float depth, vec3 worldPos, vec4 worldNormalTexel) {
#ifdef neighborhoodClamping
    return true;
#endif

    vec3 worldNormal = unpackRGBToNormal(worldNormalTexel.xyz);
    worldNormal = normalize((vec4(worldNormal, 1.) * _viewMatrix).xyz);

    vec4 lastWorldNormalTexel = textureLod(lastNormalTexture, reprojectedUv, 0.);
    vec3 lastWorldNormal = unpackRGBToNormal(lastWorldNormalTexel.xyz);
    lastWorldNormal = normalize((vec4(lastWorldNormal, 1.) * _viewMatrix).xyz);

    if (!(all(greaterThanEqual(reprojectedUv, vec2(0.))) && all(lessThanEqual(reprojectedUv, vec2(1.))))) return false;
    if (normalsDisocclusionCheck(worldNormal, lastWorldNormal)) return false;

    // the reprojected UV coordinates are inside the view
    float lastDepth = unpackRGBAToDepth(textureLod(lastDepthTexture, reprojectedUv, 0.));
    vec3 lastWorldPos = screenSpaceToWorldSpace(reprojectedUv, lastDepth, prevCameraMatrixWorld);

    if (planeDistanceDisocclusionCheck(worldPos, lastWorldPos, worldNormal)) return false;

    float depthDiff = abs(depth - lastDepth);
    if (depthDiff > 0.0001) return false;
    return true;
}

vec2 reprojectVelocity(vec2 sampleUv) {
    vec4 velocity = textureLod(velocityTexture, sampleUv, 0.0);
    velocity.xy = unpackRGBATo2Half(velocity) * 2. - 1.;

    if (all(lessThan(abs(velocity.xy), invTexSize * 0.25))) {
        velocity.xy = vec2(0.);
    }

    return vUv - velocity.xy;
}

#ifdef reprojectReflectionHitPoints
vec2 viewSpaceToScreenSpace(vec3 position) {
    vec4 projectedCoord = projectionMatrix * vec4(position, 1.0);
    projectedCoord.xy /= projectedCoord.w;
    // [-1, 1] --> [0, 1] (NDC to screen position)
    projectedCoord.xy = projectedCoord.xy * 0.5 + 0.5;

    return projectedCoord.xy;
}

vec2 reprojectHitPoint(vec3 rayOrig, float rayLength, vec2 uv, float depth) {
    vec3 cameraRay = normalize(rayOrig - cameraPos);
    float cameraRayLength = distance(rayOrig, cameraPos);

    vec3 parallaxHitPoint = cameraPos + cameraRay * (cameraRayLength + rayLength);

    vec4 reprojectedParallaxHitPoint = prevViewMatrix * vec4(parallaxHitPoint, 1.0);
    vec2 hitPointUv = viewSpaceToScreenSpace(reprojectedParallaxHitPoint.xyz);

    return hitPointUv;
}
#endif

#ifdef dilation
vec2 getDilatedDepthUV(out float currentDepth, out vec4 closestDepthTexel) {
    float closestDepth = 0.0;
    vec2 uv;

    for (int x = -1; x <= 1; x++) {
        for (int y = -1; y <= 1; y++) {
            vec2 offset = vec2(x, y) * invTexSize;
            vec2 neighborUv = vUv + offset;

            vec4 neighborDepthTexel = textureLod(depthTexture, neighborUv, 0.0);
            float depth = unpackRGBAToDepth(neighborDepthTexel);

            if (depth > closestDepth) {
                closestDepth = depth;
                closestDepthTexel = neighborDepthTexel;
                uv = neighborUv;
            }

            if (x == 0 && y == 0) {
                currentDepth = depth;
            }
        }
    }

    return uv;
}
#endif

#ifdef catmullRomSampling
vec4 SampleTextureCatmullRom(sampler2D tex, in vec2 uv, in vec2 texSize) {
    vec4 center = textureLod(tex, uv, 0.);
    float pixelSample = center.a / ALPHA_STEP + 1.0;

    if (pixelSample < 100.) {
        return center;
    }

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

    return result;
}
#endif

void main() {
    vec4 inputTexel = textureLod(inputTexture, vUv, 0.0);

#ifdef dilation
    vec4 depthTexel;
    float depth;
    vec2 uv = getDilatedDepthUV(depth, depthTexel);
#else
    vec4 depthTexel = textureLod(depthTexture, vUv, 0.);
    float depth = unpackRGBAToDepth(depthTexel);
    vec2 uv = vUv;
#endif

    bool isBackground = dot(depthTexel.rgb, depthTexel.rgb) == 0.0;
    bool isReprojectedUvValid;
    vec2 reprojectedUv;

    vec3 inputColor = inputTexel.rgb;

#ifdef logTransform
    inputColor = transformColor(inputColor);
#endif

    float alpha = 1.0;

    vec4 accumulatedTexel;
    vec3 accumulatedColor;

    if (isBackground) {
        accumulatedColor = inputColor;
    } else {
        vec3 worldPos = screenSpaceToWorldSpace(vUv, depth, cameraMatrixWorld);

        vec4 worldNormalTexel = textureLod(normalTexture, vUv, 0.);

#ifdef reprojectReflectionHitPoints
        float rayLength;
        if ((rayLength = textureLod(inputTexture, vUv, 0.).a) != 0.0) {
            reprojectedUv = reprojectHitPoint(worldPos, rayLength, uv, depth);
        } else {
            reprojectedUv = reprojectVelocity(uv);
        }
#else
        reprojectedUv = reprojectVelocity(uv);
#endif

        isReprojectedUvValid = validateReprojectedUV(reprojectedUv, depth, worldPos, worldNormalTexel);

        if (isReprojectedUvValid) {
#ifdef catmullRomSampling
            accumulatedTexel = SampleTextureCatmullRom(accumulatedTexture, reprojectedUv, 1.0 / invTexSize);
#else
            accumulatedTexel = textureLod(accumulatedTexture, reprojectedUv, 0.0);
#endif

            alpha = accumulatedTexel.a;
            alpha = min(alpha, blend);
            accumulatedColor = transformColor(accumulatedTexel.rgb);

            alpha += ALPHA_STEP;

#ifdef neighborhoodClamping
            vec3 minNeighborColor = inputColor;
            vec3 maxNeighborColor = inputColor;
            getNeighborhoodAABB(inputTexture, vUv, minNeighborColor, maxNeighborColor);

            accumulatedColor = clamp(accumulatedColor, minNeighborColor, maxNeighborColor);

            if (isBackground) accumulatedColor = inputColor;

#endif
        } else {
            accumulatedColor = inputColor;
            alpha = 0.0;
        }
    }

    vec3 outputColor = inputColor;

    float temporalResolveMix = blend;

    if (!constantBlend) {
        float pixelSample = alpha / ALPHA_STEP + 1.0;
        temporalResolveMix = min(1. - 1. / pixelSample, blend);
    }

    outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef useCustomComposeShader
    customComposeShader
#else
    gl_FragColor = vec4(undoColorTransform(outputColor), alpha);
#endif
}