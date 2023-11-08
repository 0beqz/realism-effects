import { Effect } from "postprocessing"
import { setupBlueNoise } from "../utils/BlueNoiseUtils"
import gbuffer_packing from "../gbuffer/shader/gbuffer_packing.glsl"
import { Vector2 } from "three"

const fragShader = /* glsl */ `
    uniform vec2 resolution;

    #define luminance(c) dot(c.rgb, vec3(0.299, 0.587, 0.114))

    ${gbuffer_packing}

    uniform sampler2D depthTexture;
    uniform mat4 projectionMatrix;
    uniform mat4 projectionMatrixInverse;
    uniform mat4 cameraMatrixWorld;
    uniform vec3 backgroundColor;
    uniform float maxDistance;

    // source: https://github.com/mrdoob/three.js/blob/79ea10830dfc97b6c0a7e29d217c7ff04c081095/examples/jsm/shaders/BokehShader.js#L66
    float getViewZ(const in float depth) {
        #if PERSPECTIVE_CAMERA == 1
        return perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
        #else
        return orthographicDepthToViewZ(depth, cameraNear, cameraFar);
        #endif
    }

    // source:
    // https://github.com/mrdoob/three.js/blob/dev/examples/js/shaders/SSAOShader.js
    vec3 getViewPosition(float viewZ) {
        float clipW = projectionMatrix[2][3] * viewZ + projectionMatrix[3][3];
        vec4 clipPosition = vec4((vec3(vUv, viewZ) - 0.5) * 2.0, 1.0);
        clipPosition *= clipW;
        vec3 p = (projectionMatrixInverse * clipPosition).xyz;
        p.z = viewZ;
        return p;
    }

    float ns(vec2 n) {
        const vec2 d = vec2(0.0, 1.0);
        vec2 b = floor(n), f = smoothstep(vec2(0.0), vec2(1.0), fract(n));
        return mix(mix(rand(b), rand(b + d.yx), f.x), mix(rand(b + d.xy), rand(b + d.yy), f.x), f.y);
    }

    float n4rand_ss( vec2 n )
{
	float nrnd0 = ns( n + 0.07*fract( 1. ) );
	float nrnd1 = ns( n + 0.11*fract( 1. + 0.573953 ) );	
	return 0.23*sqrt(-log(nrnd0+0.00001))*cos(2.0*3.141592*nrnd1)+0.5;
}

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        float depth = textureLod(depthTexture, uv, 0.).r;
        if(depth == 0.) {
            outputColor = inputColor;
            return;
        }

        // get the world position from the depth texture
        float viewZ = getViewZ(depth);
        // view-space position of the current texel
        vec3 viewPos = getViewPosition(viewZ);
        vec3 viewDir = normalize(viewPos);
        vec3 worldPos = (cameraMatrixWorld * vec4(viewPos, 1.)).xyz;
        
        Material mat = getMaterial(uv);
        float glossiness = 1. - mat.roughness;

        vec3 viewNormal = normalize((inverse(cameraMatrixWorld) * vec4(mat.normal, 0.)).xyz);

        // using world normal and world position, determine how much the surface is facing the camera
        float facing = max(dot(-viewDir, viewNormal), 0.);
        facing = pow(facing, 4.);
        
        float bn = blueNoise(normalize(worldPos).xz * 2.).a;

        // facing = mix(facing, bn, 0.1);

        float noise = n4rand_ss(normalize(worldPos).xz * 1000. + mat.normal.xz * 500.);
        noise = pow(noise, 10.);

        float lum = luminance(inputColor.rgb);
        lum = mix(lum, 1., mat.metalness * 0.1);

        // lum is 0 at 0.9 and 1 at 1.0
        lum = smoothstep(0.15, 1., lum);

        float secSparkleNoise = pow(n4rand_ss(viewNormal.zx * 10000.), 40.) * 0.1;

        // noise = mix(noise * 10. * pow(facing, 10.), secSparkleNoise * 0.01, 0.5);

        float sparkleFactor = noise * lum * facing * glossiness;

        vec3 color = inputColor.rgb + mat.diffuse.rgb * sparkleFactor * 1000.;
        outputColor = vec4(vec3(color), outputColor.a);
    }
`
export class SparkleEffect extends Effect {
	constructor(camera, gBufferPass) {
		const { uniforms, fragmentShader } = setupBlueNoise(fragShader)

		// convert uniforms, so we can pass them to Map
		const uniformsMap = new Map()
		Object.entries(uniforms).forEach(([key, value]) => {
			uniformsMap.set(key, value)
		})

		super("SparkleEffect", fragmentShader, {
			uniforms: new Map([
				["resolution", { value: new Vector2() }],
				["projectionMatrix", { value: camera.projectionMatrix }],
				["projectionMatrixInverse", { value: camera.projectionMatrixInverse }],
				["cameraMatrixWorld", { value: camera.matrixWorld }],
				["depthTexture", { value: gBufferPass.depthTexture }],
				["gBufferTexture", { value: gBufferPass.texture }],
				...uniformsMap
			])
		})
	}

	update(renderer, inputBuffer, deltaTime) {
		renderer.getSize(this.uniforms.get("resolution").value)
	}
}
