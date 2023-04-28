import * as THREE from "three"
import vertexShader from "../utils/shader/basic.vert"
import sampleBlueNoise from "../utils/shader/sampleBlueNoise.glsl"

const PoissionBlur = {
	uniforms: {
		sceneDepth: { value: null },
		tDiffuse: { value: null },
		projMat: { value: new THREE.Matrix4() },
		viewMat: { value: new THREE.Matrix4() },
		projectionMatrixInv: { value: new THREE.Matrix4() },
		viewMatrixInv: { value: new THREE.Matrix4() },
		cameraPos: { value: new THREE.Vector3() },
		resolution: { value: new THREE.Vector2() },
		time: { value: 0.0 },
		r: { value: 5.0 },
		blueNoise: { value: null },
		radius: { value: 12.0 },
		index: { value: 0.0 },
		blueNoise: { value: null },
		blueNoiseRepeat: { value: new THREE.Vector2() },
		texSize: { value: new THREE.Vector2() }
	},
	vertexShader,
	fragmentShader: /* glsl */ `
    uniform highp sampler2D sceneDepth;
    uniform sampler2D tDiffuse;
    uniform sampler2D blueNoise;
    uniform vec2 blueNoiseRepeat;
    uniform vec2 texSize;
    uniform mat4 projectionMatrixInv;
    uniform mat4 viewMatrixInv;
    uniform vec2 resolution;
    uniform float r;
    uniform float radius;
    uniform float index;
    varying vec2 vUv;

    #include <sampleBlueNoise>

    highp float linearize_depth(highp float d, highp float zNear,highp float zFar)
    {
        highp float z_n = 2.0 * d - 1.0;
        return 2.0 * zNear * zFar / (zFar + zNear - z_n * (zFar - zNear));
    }

    vec3 getWorldPos(float depth, vec2 coord) {
        float z = depth * 2.0 - 1.0;
        vec4 clipSpacePosition = vec4(coord * 2.0 - 1.0, z, 1.0);
        vec4 viewSpacePosition = projectionMatrixInv * clipSpacePosition;
        // Perspective division
       vec4 worldSpacePosition = viewMatrixInv * viewSpacePosition;
       worldSpacePosition.xyz /= worldSpacePosition.w;
        return worldSpacePosition.xyz;
    }

    #include <common>
    #define NUM_SAMPLES 16
    #define NUM_RINGS 11
    vec2 poissonDisk[NUM_SAMPLES];

    void initPoissonSamples( ) {
        float ANGLE_STEP = PI2 * float( NUM_RINGS ) / float( NUM_SAMPLES );
        float INV_NUM_SAMPLES = 1.0 / float( NUM_SAMPLES );

        int seed = 1;

        // jsfiddle that shows sample pattern: https://jsfiddle.net/a16ff1p7/
        //float angle = sampleBlueNoise(blueNoise, seed, blueNoiseRepeat, texSize).x * PI2;
        float angle;
        if (index == 0.0) {
                angle = sampleBlueNoise(blueNoise, seed, blueNoiseRepeat, texSize).x * PI2;
        } else if (index == 1.0) {
                angle = sampleBlueNoise(blueNoise, seed, blueNoiseRepeat, texSize).y * PI2;
        } else if (index == 2.0) {
                angle = sampleBlueNoise(blueNoise, seed, blueNoiseRepeat, texSize).z * PI2;
        } else {
                angle = sampleBlueNoise(blueNoise, seed, blueNoiseRepeat, texSize).w * PI2;
        }
        float radius = INV_NUM_SAMPLES;
        float radiusStep = radius;

        for( int i = 0; i < NUM_SAMPLES; i ++ ) {
            poissonDisk[i] = vec2( cos( angle ), sin( angle ) ) * pow( radius, 0.75 );
            radius += radiusStep;
            angle += ANGLE_STEP;
        }
    }

    void main() {
        vec4 depthTexel = textureLod(sceneDepth, vUv, 0.);

        if (depthTexel.r > 0.9999 || dot(depthTexel.rgb, depthTexel.rgb) == 0.) {
            discard;
            return;
        }

        const float pi = 3.14159;

        initPoissonSamples();

        vec2 texelSize = vec2(1.0 / resolution.x, 1.0 / resolution.y);
        vec2 uv = vUv;
        vec4 data = texture2D(tDiffuse, vUv);

        float occlusion = data.a;
        float baseOcc = data.a;
        vec3 normal = data.rgb;
        float count = 1.0;
        float d = depthTexel.x;
        float depth = linearize_depth(d, 0.1, 1000.0);
        vec3 worldPos = getWorldPos(d, vUv);
        float size = radius;

        for(int i = 0; i < NUM_SAMPLES; i++) {
            vec2 offset = poissonDisk[i] * texelSize * size;
            vec4 dataSample = textureLod(tDiffuse, uv + offset, 0.0);
            float occSample = dataSample.a;
            vec3 normalSample = dataSample.rgb;
            float dSample = textureLod(sceneDepth, uv + offset, 0.0).x;
            float depthSample = linearize_depth(dSample, 0.1, 1000.0);
            vec3 worldPosSample = getWorldPos(dSample, uv + offset);
            float tangentPlaneDist = abs(dot(worldPos - worldPosSample, normal));

            float normalDiff = max(dot(normalSample, normal), 0.);
            float normalPhi = 20.;
            float normalSimilarity = exp(-normalDiff / normalPhi);

            float rangeCheck = exp(-1.0 * tangentPlaneDist) * (0.5 + 0.5 * dot(normal, normalSample)) * (1.0 - abs(occSample - baseOcc));

            float depthPhi = 10.;
            float depthSimilarity = max(rangeCheck / depthPhi, 0.);
            
            occlusion += occSample * depthSimilarity * normalSimilarity;
            count += depthSimilarity * normalSimilarity;
        }

        occlusion /= count;
        gl_FragColor = vec4(occlusion);
    }
    `
}

PoissionBlur.fragmentShader = PoissionBlur.fragmentShader.replace("#include <sampleBlueNoise>", sampleBlueNoise)

export { PoissionBlur }
