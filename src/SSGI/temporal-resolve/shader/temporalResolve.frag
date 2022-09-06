// a basic shader to implement temporal resolving

uniform sampler2D inputTexture;
uniform sampler2D boxBlurTexture;
uniform sampler2D accumulatedTexture;
uniform sampler2D sceneTexture;
uniform sampler2D velocityTexture;
uniform sampler2D lastVelocityTexture;

uniform float blend;
uniform float correction;
uniform float exponent;
uniform float samples;
uniform vec2 invTexSize;

uniform float blur;

uniform mat4 curInverseProjectionMatrix;
uniform mat4 curCameraMatrixWorld;
uniform mat4 prevInverseProjectionMatrix;
uniform mat4 prevCameraMatrixWorld;

varying vec2 vUv;

#define FLOAT_EPSILON           0.00001
#define FLOAT_ONE_MINUS_EPSILON 0.99999

const float alphaStep = 0.001;
vec3 transformExponent;
vec3 undoColorTransformExponent;

// credits for transforming screen position to world position: https://discourse.threejs.org/t/reconstruct-world-position-in-screen-space-from-depth-buffer/5532/2
vec3 screenSpaceToWorldSpace(const vec2 uv, const float depth, mat4 inverseProjectionMatrix, mat4 cameraMatrixWorld) {
    vec4 ndc = vec4(
        (uv.x - 0.5) * 2.0,
        (uv.y - 0.5) * 2.0,
        (depth - 0.5) * 2.0,
        1.0);
    vec4 clip = inverseProjectionMatrix * ndc;
    vec4 view = cameraMatrixWorld * (clip / clip.w);
    return view.xyz;
}

// idea from: https://www.elopezr.com/temporal-aa-and-the-quest-for-the-holy-trail/
vec3 transformColor(vec3 color) {
#ifdef logTransform
    return log(max(color, vec3(FLOAT_EPSILON)));
#else
    if (exponent == 1.0) return color;
    return pow(abs(color), transformExponent);
#endif
}

vec3 undoColorTransform(vec3 color) {
#ifdef logTransform
    return exp(color);
#else
    if (exponent == 1.0) return color;
    return max(pow(abs(color), undoColorTransformExponent), vec3(0.0));
#endif
}

void main() {
    vec4 inputTexel = textureLod(inputTexture, vUv, 0.0);

    if (blur > 0. && inputTexel.a < 0.5) {
        float intensity = 0.5 - inputTexel.a;

        vec3 blurredReflectionsColor = textureLod(boxBlurTexture, vUv, 0.).rgb;

        inputTexel.rgb = mix(inputTexel.rgb, blurredReflectionsColor, blur * intensity);
    }

    vec4 sceneTexel = textureLod(sceneTexture, vUv, 0.0);

    const float directIndirectFactor = 1.0;
    inputTexel.rgb = sceneTexel.rgb * directIndirectFactor + inputTexel.rgb / directIndirectFactor;

    transformExponent = vec3(1.0 / exponent);
    undoColorTransformExponent = vec3(exponent);

    vec4 accumulatedTexel;

    vec3 inputColor = transformColor(inputTexel.rgb);
    vec3 accumulatedColor;

    float alpha = inputTexel.a;

    bool didReproject = false;

#ifdef boxBlur
    vec3 boxBlurredColor;
#endif

    vec4 velocity = textureLod(velocityTexture, vUv, 0.0);

    vec3 minNeighborColor = inputColor;
    vec3 maxNeighborColor = inputColor;

    vec4 neighborTexel;
    vec3 col;
    vec2 neighborUv;
    vec2 offset;

    vec2 reprojectedUv = vUv - velocity.xy;
    vec4 lastVelocity = textureLod(lastVelocityTexture, reprojectedUv, 0.0);

    float depth = 1.0 - velocity.b;
    float lastDepth = 1.0 - lastVelocity.b;

    float minDepth = depth;
    float lastMinDepth = lastVelocity.b;
    float maxDepth = 0.;
    float lastMaxDepth = 0.;

    float neighborDepth;
    float lastNeighborDepth;
    float colorCount = 1.0;

    bool doBoxBlur = alpha <= 0.05;

#if defined(dilation) || defined(neighborhoodClamping) || defined(boxBlur)
    for (int x = -correctionRadius; x <= correctionRadius; x++) {
        for (int y = -correctionRadius; y <= correctionRadius; y++) {
            if (x != 0 || y != 0) {
                offset = vec2(x, y) * invTexSize;
                neighborUv = vUv + offset;

                if (neighborUv.x >= 0.0 && neighborUv.x <= 1.0 && neighborUv.y >= 0.0 && neighborUv.y <= 1.0) {
                    vec4 neigborVelocity = textureLod(velocityTexture, vUv + offset, 0.0);
                    neighborDepth = 1.0 - neigborVelocity.b;

                    int absX = abs(x);
                    int absY = abs(y);

                    if (absX <= 1 && absY <= 1) {
    #ifdef dilation
                        if (neighborDepth < minDepth) {
                            velocity = neigborVelocity;
                            minDepth = neighborDepth;
                        }

                        if (neighborDepth > maxDepth) maxDepth = neighborDepth;

                        vec2 reprojectedNeighborUv = reprojectedUv + vec2(x, y) * invTexSize;

                        vec4 lastNeighborVelocity = textureLod(lastVelocityTexture, reprojectedNeighborUv, 0.0);
                        lastNeighborDepth = 1.0 - lastNeighborVelocity.b;

                        if (lastNeighborDepth < lastMinDepth) {
                            lastVelocity = lastNeighborVelocity;
                            lastMinDepth = lastNeighborDepth;
                        }

                        if (lastNeighborDepth > lastMaxDepth) lastMaxDepth = lastNeighborDepth;
    #endif
                    }

    #if defined(neighborhoodClamping) || defined(boxBlur)

                    // the neighbor pixel is invalid if it's too far away from this pixel

                    if (
        #if !defined(neighborhoodClamping) && defined(boxBlur)
                        doBoxBlur &&
        #endif
                        abs(depth - neighborDepth) < maxNeighborDepthDifference) {

                        neighborTexel = textureLod(inputTexture, neighborUv, 0.0);

                        col = neighborTexel.rgb;
                        col = transformColor(col);

        #ifdef boxBlur
                        if (absX <= 3 && absY <= 3) {
                            boxBlurredColor += col;
                            boxBlurredColor = vec3(0., 1., 0.);

                            colorCount += 1.0;
                        }
        #endif

                        minNeighborColor = min(col, minNeighborColor);
                        maxNeighborColor = max(col, maxNeighborColor);
                    }

    #endif
                }
            }
        }
    }

#endif

    // velocity
    reprojectedUv = vUv - velocity.xy;

    // box blur
#ifdef boxBlur
    if (dot(boxBlurredColor, boxBlurredColor) == 0.) {
        boxBlurredColor = inputColor;
    } else {
        boxBlurredColor /= colorCount;
    }

    boxBlurredColor = transformColor(boxBlurredColor);
#endif

// depth
#ifdef dilation
    depth = maxDepth;
    lastDepth = lastMaxDepth;
#endif

    float depthDiff = abs(depth - lastDepth);

    // the reprojected UV coordinates are inside the view
    if (reprojectedUv.x >= 0.0 && reprojectedUv.x <= 1.0 && reprojectedUv.y >= 0.0 && reprojectedUv.y <= 1.0) {
        didReproject = true;

        accumulatedTexel = textureLod(accumulatedTexture, reprojectedUv, 0.0);

        // check if this pixel belongs to the background and isn't within 1px close to a mesh (need to check for that too due to anti-aliasing)
        if (maxDepth == 1. && minDepth == 1.) {
            gl_FragColor = inputTexel;
            return;
        }

        alpha = min(alpha, accumulatedTexel.a);
        alpha = min(alpha, blend);
        accumulatedColor = transformColor(accumulatedTexel.rgb);

        alpha = didReproject && depthDiff <= maxNeighborDepthDifference ? (alpha + alphaStep) : 0.0;

#ifdef neighborhoodClamping
        vec3 clampedColor = clamp(accumulatedColor, minNeighborColor, maxNeighborColor);

        accumulatedColor = mix(accumulatedColor, clampedColor, correction);
#endif

    } else {
        // reprojected UV coordinates are outside of screen
#ifdef boxBlur
        accumulatedColor = boxBlurredColor;
#else
        accumulatedColor = inputColor;
#endif
    }

    vec3 outputColor = inputColor;

    bool isMoving = dot(velocity.xy, velocity.xy) > 0.0;

    float s = alpha / alphaStep + 1.0;
    float temporalResolveMix = 1. - 1. / s;
    temporalResolveMix = min(temporalResolveMix, blend);

// the user's shader to compose a final outputColor from the inputTexel and accumulatedTexel
#ifdef customComposeShader
    #include <customComposeShader>
#else
    outputColor = mix(inputColor, accumulatedColor, temporalResolveMix);
#endif

    gl_FragColor = vec4(undoColorTransform(outputColor), alpha);
}