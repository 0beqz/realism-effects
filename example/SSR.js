import { Pass, RenderPass, DepthPass, Effect, Selection } from "postprocessing"
import {
	ShaderMaterial,
	Uniform,
	Vector2,
	Matrix3,
	TangentSpaceNormalMap,
	GLSL3,
	Matrix4,
	Vector3,
	WebGLRenderTarget,
	LinearFilter,
	HalfFloatType,
	WebGLMultipleRenderTargets,
	ShaderChunk,
	Color,
	Quaternion,
	NearestFilter,
	VideoTexture,
	DataTexture,
	RGBAFormat,
	FloatType,
	FramebufferTexture,
	WebGLCubeRenderTarget,
	CubeCamera,
	PMREMGenerator,
	Texture
} from "three"

function _extends() {
	_extends = Object.assign
		? Object.assign.bind()
		: function (target) {
				for (let i = 1; i < arguments.length; i++) {
					const source = arguments[i]

					for (const key in source) {
						if (Object.prototype.hasOwnProperty.call(source, key)) {
							target[key] = source[key]
						}
					}
				}

				return target
		  }
	return _extends.apply(this, arguments)
}

const boxBlur =
	"#define GLSLIFY 1\nuniform float blur;uniform float blurSharpness;uniform int blurKernel;vec3 denoise(vec3 center,sampler2D tex,vec2 uv,vec2 invTexSize,float blur,float blurSharpness,int blurKernel){vec3 color;float total;vec3 col;float weight;for(int x=-blurKernel;x<=blurKernel;x++){for(int y=-blurKernel;y<=blurKernel;y++){col=textureLod(tex,uv+vec2(x,y)*invTexSize,0.).rgb;weight=1.0-abs(dot(col-center,vec3(0.25)));weight=pow(weight,blurSharpness);color+=col*weight;total+=weight;}}return color/total;}" // eslint-disable-line

const finalSSRShader =
	"#define GLSLIFY 1\n#define MODE_DEFAULT 0\n#define MODE_REFLECTIONS 1\n#define MODE_RAW_REFLECTION 2\n#define MODE_BLURRED_REFLECTIONS 3\n#define MODE_INPUT 4\n#define MODE_BLUR_MIX 5\n#define FLOAT_EPSILON 0.00001\nuniform sampler2D inputTexture;uniform sampler2D reflectionsTexture;uniform float intensity;\n#include <boxBlur>\nvoid mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){vec4 reflectionsTexel=texture2D(reflectionsTexture,vUv);ivec2 size=textureSize(reflectionsTexture,0);vec2 invTexSize=1./vec2(size.x,size.y);vec3 reflectionClr=reflectionsTexel.xyz;if(blur>FLOAT_EPSILON){vec3 blurredReflectionsColor=denoise(reflectionsTexel.rgb,reflectionsTexture,vUv,invTexSize,blur,blurSharpness,blurKernel);reflectionClr=mix(reflectionClr,blurredReflectionsColor.rgb,blur);}reflectionClr*=intensity;\n#if RENDER_MODE == MODE_DEFAULT\noutputColor=vec4(inputColor.rgb+reflectionClr,1.0);\n#endif\n#if RENDER_MODE == MODE_REFLECTIONS\noutputColor=vec4(reflectionClr,1.0);\n#endif\n#if RENDER_MODE == MODE_RAW_REFLECTION\noutputColor=vec4(reflectionsTexel.xyz,1.0);\n#endif\n#if RENDER_MODE == MODE_BLURRED_REFLECTIONS\noutputColor=vec4(blurredReflectionsTexel.xyz,1.0);\n#endif\n#if RENDER_MODE == MODE_INPUT\noutputColor=vec4(inputColor.xyz,1.0);\n#endif\n#if RENDER_MODE == MODE_BLUR_MIX\noutputColor=vec4(vec3(blur),1.0);\n#endif\n}" // eslint-disable-line

const helperFunctions =
	"#define GLSLIFY 1\nvec3 getViewPosition(const float depth){float clipW=_projectionMatrix[2][3]*depth+_projectionMatrix[3][3];vec4 clipPosition=vec4((vec3(vUv,depth)-0.5)*2.0,1.0);clipPosition*=clipW;return(_inverseProjectionMatrix*clipPosition).xyz;}float getViewZ(const in float depth){\n#ifdef PERSPECTIVE_CAMERA\nreturn perspectiveDepthToViewZ(depth,cameraNear,cameraFar);\n#else\nreturn orthographicDepthToViewZ(depth,cameraNear,cameraFar);\n#endif\n}vec3 screenSpaceToWorldSpace(const vec2 uv,const float depth){vec4 ndc=vec4((uv.x-0.5)*2.0,(uv.y-0.5)*2.0,(depth-0.5)*2.0,1.0);vec4 clip=_inverseProjectionMatrix*ndc;vec4 view=cameraMatrixWorld*(clip/clip.w);return view.xyz;}\n#define Scale (vec3(0.8, 0.8, 0.8))\n#define K (19.19)\nvec3 hash(vec3 a){a=fract(a*Scale);a+=dot(a,a.yxz+K);return fract((a.xxy+a.yxx)*a.zyx);}float fresnel_dielectric_cos(float cosi,float eta){float c=abs(cosi);float g=eta*eta-1.0+c*c;float result;if(g>0.0){g=sqrt(g);float A=(g-c)/(g+c);float B=(c*(g+c)-1.0)/(c*(g-c)+1.0);result=0.5*A*A*(1.0+B*B);}else{result=1.0;}return result;}float fresnel_dielectric(vec3 Incoming,vec3 Normal,float eta){float cosine=dot(Incoming,Normal);return min(1.0,5.0*fresnel_dielectric_cos(cosine,eta));}" // eslint-disable-line

const trCompose =
	"#define GLSLIFY 1\n#define INV_EULER 0.36787944117144233\nalpha=velocityDisocclusion<FLOAT_EPSILON ?(alpha+0.0075): 0.0;alpha=clamp(alpha,0.0,1.0);bool needsBlur=!didReproject||velocityDisocclusion>0.5;\n#ifdef boxBlur\nif(needsBlur)inputColor=boxBlurredColor;\n#endif\nif(false&&alpha==1.0){outputColor=accumulatedColor;}else{float m=blend;if(needsBlur)m=0.0;m=1.-1./(samples);m=max(m,blend);if(!didReproject)m=0.;outputColor=accumulatedColor*m+inputColor*(1.0-m);}" // eslint-disable-line

// WebGL2: will render normals to RGB channel of "gNormal" buffer, roughness to A channel of "gNormal" buffer, depth to RGBA channel of "gDepth" buffer
// and velocity to "gVelocity" buffer

class MRTMaterial extends ShaderMaterial {
	constructor() {
		super({
			type: "MRTMaterial",
			defines: {
				USE_UV: "",
				TEMPORAL_RESOLVE: ""
			},
			uniforms: {
				opacity: new Uniform(1),
				normalMap: new Uniform(null),
				normalScale: new Uniform(new Vector2(1, 1)),
				uvTransform: new Uniform(new Matrix3()),
				roughness: new Uniform(1),
				roughnessMap: new Uniform(null)
			},
			vertexShader:
				/* glsl */
				`
                #ifdef USE_MRT
                 varying vec2 vHighPrecisionZW;
                #endif
                #define NORMAL
                #if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
                    varying vec3 vViewPosition;
                #endif
                #include <common>
                #include <uv_pars_vertex>
                #include <displacementmap_pars_vertex>
                #include <normal_pars_vertex>
                #include <morphtarget_pars_vertex>
                #include <skinning_pars_vertex>
                #include <logdepthbuf_pars_vertex>
                #include <clipping_planes_pars_vertex>
                void main() {
                    #include <uv_vertex>
                    #include <beginnormal_vertex>
                    #include <morphnormal_vertex>
                    #include <skinbase_vertex>
                    #include <skinnormal_vertex>
                    #include <defaultnormal_vertex>
                    #include <normal_vertex>
                    #include <begin_vertex>
                    #include <morphtarget_vertex>
                    #include <skinning_vertex>
                    #include <displacementmap_vertex>
                    #include <project_vertex>
                    #include <logdepthbuf_vertex>
                    #include <clipping_planes_vertex>
                    #if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
                        vViewPosition = - mvPosition.xyz;
                    #endif
                    #ifdef USE_MRT
                        vHighPrecisionZW = gl_Position.zw;
                    #endif 
                    #ifdef USE_UV
                        vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
                    #endif
                }
            `,
			fragmentShader:
				/* glsl */
				`
                 #define NORMAL
                #if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( TANGENTSPACE_NORMALMAP )
                    varying vec3 vViewPosition;
                #endif
                #include <packing>
                #include <uv_pars_fragment>
                #include <normal_pars_fragment>
                #include <bumpmap_pars_fragment>
                #include <normalmap_pars_fragment>
                #include <logdepthbuf_pars_fragment>
                #include <clipping_planes_pars_fragment>
                #include <roughnessmap_pars_fragment>
                
                #ifdef USE_MRT
                layout(location = 0) out vec4 gNormal;
                layout(location = 1) out vec4 gDepth;
                
                varying vec2 vHighPrecisionZW;
                #endif
                uniform float roughness;
                void main() {
                    #include <clipping_planes_fragment>
                    #include <logdepthbuf_fragment>
                    #include <normal_fragment_begin>
                    #include <normal_fragment_maps>

                    float roughnessFactor = roughness;
                    
                    if(roughness > 10.0e9){
                        roughnessFactor = 1.;
                    }else{
                        #ifdef useRoughnessMap
                            vec4 texelRoughness = texture2D( roughnessMap, vUv );
                            // reads channel G, compatible with a combined OcclusionRoughnessMetallic (RGB) texture
                            roughnessFactor *= texelRoughness.g;
                        #endif
                    }

                    vec3 normalColor = packNormalToRGB( normal );
                    #ifdef USE_MRT
                        float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
                        vec4 depthColor = packDepthToRGBA( fragCoordZ );
                        gNormal = vec4( normalColor, roughnessFactor );
                        gDepth = depthColor;
                    #else
                        gl_FragColor = vec4(normalColor, roughnessFactor);
                    #endif
                }
            `,
			toneMapped: false
		})
		this.normalMapType = TangentSpaceNormalMap
		this.normalScale = new Vector2(1, 1)
		Object.defineProperty(this, "glslVersion", {
			get() {
				return "USE_MRT" in this.defines ? GLSL3 : null
			},

			set(_) {}
		})
	}
}

const vertexShader$1 =
	"#define GLSLIFY 1\nvarying vec2 vUv;void main(){vUv=position.xy*0.5+0.5;gl_Position=vec4(position.xy,1.0,1.0);}" // eslint-disable-line

const fragmentShader =
	"#define GLSLIFY 1\nvarying vec2 vUv;uniform sampler2D inputTexture;uniform sampler2D accumulatedTexture;uniform sampler2D normalTexture;uniform sampler2D depthTexture;uniform sampler2D envMap;uniform mat4 _projectionMatrix;uniform mat4 _inverseProjectionMatrix;uniform mat4 cameraMatrixWorld;uniform float cameraNear;uniform float cameraFar;uniform float rayDistance;uniform float maxDepthDifference;uniform float roughnessFade;uniform float maxRoughness;uniform float fade;uniform float thickness;uniform float ior;uniform float samples;uniform float jitter;uniform float jitterRoughness;\n#define INVALID_RAY_COORDS vec2(-1.0);\n#define EARLY_OUT_COLOR vec4(0.0, 0.0, 0.0, 1.0)\n#define FLOAT_EPSILON 0.00001\nfloat nearMinusFar;float nearMulFar;float farMinusNear;\n#include <packing>\n#include <helperFunctions>\nvec2 RayMarch(vec3 dir,inout vec3 hitPos,inout float rayHitDepthDifference);vec2 BinarySearch(in vec3 dir,inout vec3 hitPos,inout float rayHitDepthDifference);float fastGetViewZ(const in float depth);vec3 getIBLRadiance(const in vec3 viewDir,const in vec3 normal,const in float roughness);void main(){vec4 depthTexel=textureLod(depthTexture,vUv,0.0);if(dot(depthTexel.rgb,depthTexel.rgb)<FLOAT_EPSILON){gl_FragColor=EARLY_OUT_COLOR;return;}float unpackedDepth=unpackRGBAToDepth(depthTexel);vec4 normalTexel=textureLod(normalTexture,vUv,0.0);float roughness=normalTexel.a;float specular=1.0-roughness;nearMinusFar=cameraNear-cameraFar;nearMulFar=cameraNear*cameraFar;farMinusNear=cameraFar-cameraNear;normalTexel.rgb=unpackRGBToNormal(normalTexel.rgb);float depth=fastGetViewZ(unpackedDepth);vec3 viewPos=getViewPosition(depth);vec3 viewDir=normalize(viewPos);vec3 viewNormal=normalTexel.xyz;vec3 worldPos=screenSpaceToWorldSpace(vUv,unpackedDepth);vec3 jitt=vec3(0.0);if(jitterRoughness!=0.0||jitter!=0.0){vec3 randomJitter=hash(50.0*samples*worldPos)-0.5;float spread=((2.0-specular)+roughness*jitterRoughness);float jitterMix=jitter*0.25+jitterRoughness*roughness;if(jitterMix>1.0)jitterMix=1.0;jitt=mix(vec3(0.0),randomJitter*spread,jitterMix);}viewNormal+=jitt;float fresnelFactor=fresnel_dielectric(viewDir,viewNormal,ior);vec3 iblRadiance=getIBLRadiance(-viewDir,viewNormal,0.)*fresnelFactor;iblRadiance=clamp(iblRadiance,vec3(0.0),vec3(1.0));float lastFrameAlpha=textureLod(accumulatedTexture,vUv,0.0).a;if(roughness>maxRoughness||(roughness>1.0-FLOAT_EPSILON&&roughnessFade>1.0-FLOAT_EPSILON)){gl_FragColor=vec4(iblRadiance,lastFrameAlpha);return;}vec3 reflected=reflect(viewDir,viewNormal);vec3 rayDir=reflected*-viewPos.z;vec3 hitPos=viewPos;float rayHitDepthDifference;vec2 coords=RayMarch(rayDir,hitPos,rayHitDepthDifference);if(coords.x==-1.0){gl_FragColor=vec4(iblRadiance,lastFrameAlpha);return;}vec4 SSRTexel=textureLod(inputTexture,coords.xy,0.0);vec4 SSRTexelReflected=textureLod(accumulatedTexture,coords.xy,0.0);vec3 SSR=SSRTexel.rgb+SSRTexelReflected.rgb;float roughnessFactor=mix(specular,1.0,max(0.0,1.0-roughnessFade));vec2 coordsNDC=(coords.xy*2.0-1.0);float screenFade=0.1;float maxDimension=min(1.0,max(abs(coordsNDC.x),abs(coordsNDC.y)));float reflectionIntensity=1.0-(max(0.0,maxDimension-screenFade)/(1.0-screenFade));reflectionIntensity=max(0.,reflectionIntensity);vec3 finalSSR=mix(iblRadiance,SSR,reflectionIntensity)*roughnessFactor;if(fade!=0.0){vec3 hitWorldPos=screenSpaceToWorldSpace(coords,rayHitDepthDifference);float reflectionDistance=distance(hitWorldPos,worldPos)+1.0;float opacity=1.0/(reflectionDistance*fade*0.1);if(opacity>1.0)opacity=1.0;finalSSR*=opacity;}finalSSR*=fresnelFactor;finalSSR=min(vec3(1.0),finalSSR);float alpha=hitPos.z==1.0 ? 1.0 : SSRTexelReflected.a;alpha=min(lastFrameAlpha,alpha);gl_FragColor=vec4(finalSSR,alpha);}vec2 RayMarch(vec3 dir,inout vec3 hitPos,inout float rayHitDepthDifference){dir=normalize(dir);dir*=rayDistance/float(steps);float depth;vec4 projectedCoord;vec4 lastProjectedCoord;float unpackedDepth;vec4 depthTexel;for(int i=0;i<steps;i++){hitPos+=dir;projectedCoord=_projectionMatrix*vec4(hitPos,1.0);projectedCoord.xy/=projectedCoord.w;projectedCoord.xy=projectedCoord.xy*0.5+0.5;\n#ifndef missedRays\nif(projectedCoord.x<0.0||projectedCoord.x>1.0||projectedCoord.y<0.0||projectedCoord.y>1.0){return INVALID_RAY_COORDS;}\n#endif\ndepthTexel=textureLod(depthTexture,projectedCoord.xy,0.0);unpackedDepth=unpackRGBAToDepth(depthTexel);depth=fastGetViewZ(unpackedDepth);rayHitDepthDifference=depth-hitPos.z;if(rayHitDepthDifference>=0.0&&rayHitDepthDifference<thickness){\n#if refineSteps == 0\nif(dot(depthTexel.rgb,depthTexel.rgb)<FLOAT_EPSILON)return INVALID_RAY_COORDS;\n#else\nreturn BinarySearch(dir,hitPos,rayHitDepthDifference);\n#endif\n}\n#ifndef missedRays\nif(hitPos.z>0.0){return INVALID_RAY_COORDS;}\n#endif\nlastProjectedCoord=projectedCoord;}hitPos.z=1.0;\n#ifndef missedRays\nreturn INVALID_RAY_COORDS;\n#endif\nrayHitDepthDifference=unpackedDepth;return projectedCoord.xy;}vec2 BinarySearch(in vec3 dir,inout vec3 hitPos,inout float rayHitDepthDifference){float depth;vec4 projectedCoord;vec2 lastMinProjectedCoordXY;float unpackedDepth;vec4 depthTexel;for(int i=0;i<refineSteps;i++){projectedCoord=_projectionMatrix*vec4(hitPos,1.0);projectedCoord.xy/=projectedCoord.w;projectedCoord.xy=projectedCoord.xy*0.5+0.5;depthTexel=textureLod(depthTexture,projectedCoord.xy,0.0);unpackedDepth=unpackRGBAToDepth(depthTexel);depth=fastGetViewZ(unpackedDepth);rayHitDepthDifference=depth-hitPos.z;dir*=0.5;if(rayHitDepthDifference>0.0){hitPos-=dir;}else{hitPos+=dir;}}if(dot(depthTexel.rgb,depthTexel.rgb)<FLOAT_EPSILON)return INVALID_RAY_COORDS;if(abs(rayHitDepthDifference)>maxDepthDifference)return INVALID_RAY_COORDS;projectedCoord=_projectionMatrix*vec4(hitPos,1.0);projectedCoord.xy/=projectedCoord.w;projectedCoord.xy=projectedCoord.xy*0.5+0.5;rayHitDepthDifference=unpackedDepth;return projectedCoord.xy;}float fastGetViewZ(const in float depth){\n#ifdef PERSPECTIVE_CAMERA\nreturn nearMulFar/(farMinusNear*depth-cameraFar);\n#else\nreturn depth*nearMinusFar-cameraNear;\n#endif\n}\n#include <common>\n#include <cube_uv_reflection_fragment>\nvec3 getIBLRadiance(const in vec3 viewDir,const in vec3 normal,const in float roughness){\n#if defined(ENVMAP_TYPE_CUBE_UV)\nvec3 reflectVec=reflect(-viewDir,normal);reflectVec=normalize(mix(reflectVec,normal,roughness*roughness));reflectVec=inverseTransformDirection(reflectVec,viewMatrix);vec4 envMapColor=textureCubeUV(envMap,reflectVec,roughness);return envMapColor.rgb*0.;\n#else\nreturn vec3(0.0);\n#endif\n}" // eslint-disable-line

class ReflectionsMaterial extends ShaderMaterial {
	constructor() {
		super({
			type: "ReflectionsMaterial",
			uniforms: {
				inputTexture: new Uniform(null),
				accumulatedTexture: new Uniform(null),
				normalTexture: new Uniform(null),
				depthTexture: new Uniform(null),
				_projectionMatrix: new Uniform(new Matrix4()),
				_inverseProjectionMatrix: new Uniform(new Matrix4()),
				cameraMatrixWorld: new Uniform(new Matrix4()),
				cameraNear: new Uniform(0),
				cameraFar: new Uniform(0),
				rayDistance: new Uniform(0),
				roughnessFade: new Uniform(0),
				fade: new Uniform(0),
				thickness: new Uniform(0),
				ior: new Uniform(0),
				maxDepthDifference: new Uniform(0),
				jitter: new Uniform(0),
				jitterRoughness: new Uniform(0),
				maxRoughness: new Uniform(0),
				samples: new Uniform(0),
				envMap: new Uniform(null),
				envMapPosition: new Uniform(new Vector3()),
				envMapSize: new Uniform(new Vector3()),
				viewMatrix: new Uniform(new Matrix4())
			},
			defines: {
				steps: 20,
				refineSteps: 5,
				CUBEUV_TEXEL_WIDTH: 0,
				CUBEUV_TEXEL_HEIGHT: 0,
				CUBEUV_MAX_MIP: 0,
				vWorldPosition: "worldPos"
			},
			fragmentShader: fragmentShader.replace("#include <helperFunctions>", helperFunctions),
			vertexShader: vertexShader$1,
			toneMapped: false,
			depthWrite: false,
			depthTest: false
		})
	}
}

const getVisibleChildren = object => {
	const queue = [object]
	const objects = []

	while (queue.length !== 0) {
		const mesh = queue.shift()
		if (mesh.material) objects.push(mesh)

		for (const c of mesh.children) {
			if (c.visible) queue.push(c)
		}
	}

	return objects
}
const generateCubeUVSize = parameters => {
	const imageHeight = parameters.envMapCubeUVHeight
	if (imageHeight === null) return null
	const maxMip = Math.log2(imageHeight) - 2
	const texelHeight = 1.0 / imageHeight
	const texelWidth = 1.0 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16))
	return {
		texelWidth,
		texelHeight,
		maxMip
	}
}
const setupEnvMap = (reflectionsMaterial, envMap, envMapCubeUVHeight) => {
	reflectionsMaterial.uniforms.envMap.value = envMap
	const envMapCubeUVSize = generateCubeUVSize({
		envMapCubeUVHeight
	})
	reflectionsMaterial.defines.ENVMAP_TYPE_CUBE_UV = ""
	reflectionsMaterial.defines.CUBEUV_TEXEL_WIDTH = envMapCubeUVSize.texelWidth
	reflectionsMaterial.defines.CUBEUV_TEXEL_HEIGHT = envMapCubeUVSize.texelHeight
	reflectionsMaterial.defines.CUBEUV_MAX_MIP = envMapCubeUVSize.maxMip + ".0"
	reflectionsMaterial.needsUpdate = true
}

const isWebGL2Available = () => {
	try {
		const canvas = document.createElement("canvas")
		return !!(window.WebGL2RenderingContext && canvas.getContext("webgl2"))
	} catch (e) {
		return false
	}
}

class ReflectionsPass extends Pass {
	constructor(ssrEffect, options = {}) {
		super("ReflectionsPass")
		this.ssrEffect = void 0
		this.cachedMaterials = new WeakMap()
		this.USE_MRT = false
		this.webgl1DepthPass = null
		this.visibleMeshes = []
		this.ssrEffect = ssrEffect
		this._scene = ssrEffect._scene
		this._camera = ssrEffect._camera
		this.fullscreenMaterial = new ReflectionsMaterial()
		if (ssrEffect._camera.isPerspectiveCamera) this.fullscreenMaterial.defines.PERSPECTIVE_CAMERA = ""
		const width = options.width || typeof window !== "undefined" ? window.innerWidth : 2000
		const height = options.height || typeof window !== "undefined" ? window.innerHeight : 1000
		this.renderTarget = new WebGLRenderTarget(width, height, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: HalfFloatType,
			depthBuffer: false
		})
		this.renderPass = new RenderPass(this._scene, this._camera)
		this.USE_MRT = isWebGL2Available()

		if (this.USE_MRT) {
			// buffers: normal, depth (2), roughness will be written to the alpha channel of the normal buffer
			this.gBuffersRenderTarget = new WebGLMultipleRenderTargets(width, height, 2, {
				minFilter: LinearFilter,
				magFilter: LinearFilter
			})
			this.normalTexture = this.gBuffersRenderTarget.texture[0]
			this.depthTexture = this.gBuffersRenderTarget.texture[1]
		} else {
			// depth pass
			this.webgl1DepthPass = new DepthPass(this._scene, this._camera)
			this.webgl1DepthPass.renderTarget.minFilter = LinearFilter
			this.webgl1DepthPass.renderTarget.magFilter = LinearFilter
			this.webgl1DepthPass.renderTarget.texture.minFilter = LinearFilter
			this.webgl1DepthPass.renderTarget.texture.magFilter = LinearFilter
			this.webgl1DepthPass.setSize(
				typeof window !== "undefined" ? window.innerWidth : 2000,
				typeof window !== "undefined" ? window.innerHeight : 1000
			) // render normals (in the rgb channel) and roughness (in the alpha channel) in gBuffersRenderTarget

			this.gBuffersRenderTarget = new WebGLRenderTarget(width, height, {
				minFilter: LinearFilter,
				magFilter: LinearFilter
			})
			this.normalTexture = this.gBuffersRenderTarget.texture
			this.depthTexture = this.webgl1DepthPass.texture
		} // set up uniforms

		this.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture
		this.fullscreenMaterial.uniforms.depthTexture.value = this.depthTexture
		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.ssrEffect.temporalResolvePass.accumulatedTexture
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = this._camera.matrixWorld
		this.fullscreenMaterial.uniforms._projectionMatrix.value = this._camera.projectionMatrix
		this.fullscreenMaterial.uniforms._inverseProjectionMatrix.value = this._camera.projectionMatrixInverse
	}

	setSize(width, height) {
		this.renderTarget.setSize(width * this.ssrEffect.resolutionScale, height * this.ssrEffect.resolutionScale)
		this.gBuffersRenderTarget.setSize(width * this.ssrEffect.resolutionScale, height * this.ssrEffect.resolutionScale)
		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.ssrEffect.temporalResolvePass.accumulatedTexture
		this.fullscreenMaterial.needsUpdate = true
	}

	dispose() {
		this.renderTarget.dispose()
		this.gBuffersRenderTarget.dispose()
		this.renderPass.dispose()
		if (!this.USE_MRT) this.webgl1DepthPass.dispose()
		this.fullscreenMaterial.dispose()
		this.normalTexture = null
		this.depthTexture = null
		this.velocityTexture = null
	}

	keepMaterialMapUpdated(mrtMaterial, originalMaterial, prop, define) {
		if (this.ssrEffect[define]) {
			if (originalMaterial[prop] !== mrtMaterial[prop]) {
				mrtMaterial[prop] = originalMaterial[prop]
				mrtMaterial.uniforms[prop].value = originalMaterial[prop]

				if (originalMaterial[prop]) {
					mrtMaterial.defines[define] = ""
				} else {
					delete mrtMaterial.defines[define]
				}

				mrtMaterial.needsUpdate = true
			}
		} else if (mrtMaterial[prop] !== undefined) {
			mrtMaterial[prop] = undefined
			mrtMaterial.uniforms[prop].value = undefined
			delete mrtMaterial.defines[define]
			mrtMaterial.needsUpdate = true
		}
	}

	setMRTMaterialInScene() {
		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			if (c.material) {
				const originalMaterial = c.material
				let [cachedOriginalMaterial, mrtMaterial] = this.cachedMaterials.get(c) || []

				if (originalMaterial !== cachedOriginalMaterial) {
					if (mrtMaterial) mrtMaterial.dispose()
					mrtMaterial = new MRTMaterial()
					if (this.USE_MRT) mrtMaterial.defines.USE_MRT = ""
					mrtMaterial.normalScale = originalMaterial.normalScale
					mrtMaterial.uniforms.normalScale.value = originalMaterial.normalScale
					const map =
						originalMaterial.map ||
						originalMaterial.normalMap ||
						originalMaterial.roughnessMap ||
						originalMaterial.metalnessMap
					if (map) mrtMaterial.uniforms.uvTransform.value = map.matrix
					this.cachedMaterials.set(c, [originalMaterial, mrtMaterial])
				} // update the child's MRT material

				this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "normalMap", "useNormalMap")
				this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "roughnessMap", "useRoughnessMap")
				mrtMaterial.uniforms.roughness.value =
					this.ssrEffect.selection.size === 0 || this.ssrEffect.selection.has(c)
						? originalMaterial.roughness || 0
						: 10e10
				c.material = mrtMaterial
			}
		}
	}

	unsetMRTMaterialInScene() {
		for (const c of this.visibleMeshes) {
			var _c$material

			if (((_c$material = c.material) == null ? void 0 : _c$material.type) === "MRTMaterial") {
				c.visible = true // set material back to the original one

				const [originalMaterial] = this.cachedMaterials.get(c)
				c.material = originalMaterial
			}
		}
	}

	render(renderer, inputBuffer) {
		this.setMRTMaterialInScene()
		renderer.setRenderTarget(this.gBuffersRenderTarget)
		this.renderPass.render(renderer, this.gBuffersRenderTarget)
		this.unsetMRTMaterialInScene() // render depth and velocity in seperate passes

		if (!this.USE_MRT) this.webgl1DepthPass.renderPass.render(renderer, this.webgl1DepthPass.renderTarget)
		this.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture
		this.fullscreenMaterial.uniforms.samples.value = this.ssrEffect.temporalResolvePass.samples
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far
		this.fullscreenMaterial.uniforms.viewMatrix.value.copy(this._camera.matrixWorldInverse)
		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}

/**
 * Options of the SSR effect
 * @typedef {Object} SSROptions
 * @property {Number} [intensity] intensity of the reflections
 * @property {Number} [exponent] exponent by which reflections will be potentiated when composing the current frame's reflections and the accumulated reflections into a final reflection; higher values will make reflections clearer by highlighting darker spots less
 * @property {Number} [distance] maximum distance a reflection ray can travel to find what it reflects
 * @property {Number} [fade] how much reflections will fade out by distance
 * @property {Number} [roughnessFade] how intense reflections should be on rough spots; a higher value will make reflections fade out quicker on rough spots
 * @property {Number} [thickness] maximum depth difference between a ray and the particular depth at its screen position before refining with binary search; higher values will result in better performance
 * @property {Number} [ior] Index of Refraction, used for calculating fresnel; reflections tend to be more intense the steeper the angle between them and the viewer is, the ior parameter sets how much the intensity varies
 * @property {Number} [maxRoughness] maximum roughness a texel can have to have reflections calculated for it
 * @property {Number} [maxDepthDifference] maximum depth difference between a ray and the particular depth at its screen position after refining with binary search; higher values will result in better performance
 * @property {Number} [blend] a value between 0 and 1 to set how much the last frame's reflections should be blended in; higher values will result in less noisy reflections when moving the camera but a more smeary look
 * @property {boolean} [correction] how much pixels should be corrected when doing temporal resolving; higher values will result in less smearing but more noise
 * @property {boolean} [correctionRadius] how many surrounding pixels will be used for neighborhood clamping; a higher value can reduce noise when moving the camera but will result in less performance
 * @property {Number} [blur] how much the blurred reflections should be mixed with the raw reflections
 * @property {Number} [blurKernel] kernel size of the Box Blur Filter; higher kernel sizes will result in blurrier reflections with more artifacts
 * @property {Number} [blurSharpness] exponent of the Box Blur filter; higher values will result in more sharpness
 * @property {Number} [jitter] how intense jittering should be
 * @property {Number} [jitterRoughness] how intense jittering should be in relation to a material's roughness
 * @property {Number} [steps] number of steps a reflection ray can maximally do to find an object it intersected (and thus reflects)
 * @property {Number} [refineSteps] once we had our ray intersect something, we need to find the exact point in space it intersected and thus it reflects; this can be done through binary search with the given number of maximum steps
 * @property {boolean} [missedRays] if there should still be reflections for rays for which a reflecting point couldn't be found; enabling this will result in stretched looking reflections which can look good or bad depending on the angle
 * @property {boolean} [useNormalMap] if roughness maps should be taken account of when calculating reflections
 * @property {boolean} [useRoughnessMap] if normal maps should be taken account of when calculating reflections
 * @property {Number} [resolutionScale] resolution of the SSR effect, a resolution of 0.5 means the effect will be rendered at half resolution
 * @property {Number} [velocityResolutionScale] resolution of the velocity buffer, a resolution of 0.5 means velocity will be rendered at half resolution
 */

/**
 * The options of the SSR effect
 * @type {SSROptions}
 */
const defaultSSROptions = {
	intensity: 1,
	exponent: 1,
	distance: 10,
	fade: 0,
	roughnessFade: 1,
	thickness: 10,
	ior: 1.45,
	maxRoughness: 1,
	maxDepthDifference: 10,
	blend: 0.9,
	correction: 1,
	correctionRadius: 1,
	blur: 0.5,
	blurKernel: 1,
	blurSharpness: 10,
	jitter: 0,
	jitterRoughness: 0,
	steps: 20,
	refineSteps: 5,
	missedRays: true,
	useNormalMap: true,
	useRoughnessMap: true,
	resolutionScale: 1,
	velocityResolutionScale: 1
}

const vertexShader =
	"#define GLSLIFY 1\nvarying vec2 vUv;void main(){vUv=position.xy*0.5+0.5;gl_Position=vec4(position.xy,1.0,1.0);}" // eslint-disable-line

const temporalResolve =
	"#define GLSLIFY 1\nuniform sampler2D inputTexture;uniform sampler2D accumulatedTexture;uniform sampler2D velocityTexture;uniform sampler2D lastVelocityTexture;uniform float blend;uniform float correction;uniform float exponent;uniform float samples;uniform vec2 invTexSize;uniform mat4 curInverseProjectionMatrix;uniform mat4 curCameraMatrixWorld;uniform mat4 prevInverseProjectionMatrix;uniform mat4 prevCameraMatrixWorld;varying vec2 vUv;\n#define FLOAT_EPSILON 0.00001\n#define FLOAT_ONE_MINUS_EPSILON 0.99999\nvec3 transformexponent;vec3 undoColorTransformExponent;vec3 transformColor(vec3 color){if(exponent==1.0)return color;\n#ifdef logTransform\nreturn log(max(color,vec3(FLOAT_EPSILON)));\n#else\nreturn pow(abs(color),transformexponent);\n#endif\n}vec3 undoColorTransform(vec3 color){if(exponent==1.0)return color;\n#ifdef logTransform\nreturn exp(color);\n#else\nreturn max(pow(abs(color),undoColorTransformExponent),vec3(0.0));\n#endif\n}void main(){if(exponent!=1.0){transformexponent=vec3(1.0/exponent);undoColorTransformExponent=vec3(exponent);}vec4 inputTexel=textureLod(inputTexture,vUv,0.0);vec4 accumulatedTexel;vec3 inputColor=transformColor(inputTexel.rgb);vec3 accumulatedColor;float alpha=inputTexel.a;float velocityDisocclusion;bool didReproject=false;\n#ifdef boxBlur\nvec3 boxBlurredColor=inputTexel.rgb;\n#endif\nvec4 velocity=textureLod(velocityTexture,vUv,0.0);float depth=velocity.b;bool isMoving=alpha<1.0||dot(velocity.xy,velocity.xy)>0.0;if(true){vec3 minNeighborColor=inputColor;vec3 maxNeighborColor=inputColor;vec3 col;vec2 neighborUv;vec2 reprojectedUv=vUv-velocity.xy;vec4 lastVelocity=textureLod(lastVelocityTexture,reprojectedUv,0.0);float closestDepth=depth;float lastClosestDepth=lastVelocity.b;float neighborDepth;float lastNeighborDepth;float colorCount=1.0;for(int x=-correctionRadius;x<=correctionRadius;x++){for(int y=-correctionRadius;y<=correctionRadius;y++){if(x!=0||y!=0){neighborUv=vUv+vec2(x,y)*invTexSize;if(neighborUv.x>=0.0&&neighborUv.x<=1.0&&neighborUv.y>=0.0&&neighborUv.y<=1.0){vec4 neigborVelocity=textureLod(velocityTexture,neighborUv,0.0);neighborDepth=neigborVelocity.b;int absX=abs(x);int absY=abs(y);\n#ifdef dilation\nif(absX<=1&&absY<=1){if(neighborDepth>closestDepth){velocity=neigborVelocity;closestDepth=neighborDepth;}vec4 lastNeighborVelocity=textureLod(velocityTexture,vUv+vec2(x,y)*invTexSize,0.0);lastNeighborDepth=lastNeighborVelocity.b;if(lastNeighborDepth>lastClosestDepth){lastVelocity=lastNeighborVelocity;lastClosestDepth=lastNeighborDepth;}}\n#endif\nif(abs(depth-neighborDepth)<maxNeighborDepthDifference){col=textureLod(inputTexture,neighborUv,0.0).xyz;col=transformColor(col);\n#ifdef boxBlur\nif(absX<=2&&absY<=2){boxBlurredColor+=col;colorCount+=1.0;}\n#endif\nminNeighborColor=min(col,minNeighborColor);maxNeighborColor=max(col,maxNeighborColor);}}}}}float velocityLength=length(lastVelocity.xy-velocity.xy);velocityDisocclusion=(velocityLength-0.000005)*10.0;velocityDisocclusion*=velocityDisocclusion;reprojectedUv=vUv-velocity.xy;\n#ifdef boxBlur\nboxBlurredColor/=colorCount;\n#endif\nif(reprojectedUv.x>=0.0&&reprojectedUv.x<=1.0&&reprojectedUv.y>=0.0&&reprojectedUv.y<=1.0){accumulatedTexel=textureLod(accumulatedTexture,reprojectedUv,0.0);alpha=min(alpha,accumulatedTexel.a);accumulatedColor=transformColor(accumulatedTexel.rgb);if(alpha<1.0){vec3 clampedColor=clamp(accumulatedColor,minNeighborColor,maxNeighborColor);accumulatedColor=mix(accumulatedColor,clampedColor,correction);}vec3 clampedColor=clamp(accumulatedColor,minNeighborColor,maxNeighborColor);accumulatedColor=mix(accumulatedColor,clampedColor,correction);didReproject=true;}else{\n#ifdef boxBlur\naccumulatedColor=boxBlurredColor;\n#else\naccumulatedColor=inputColor;\n#endif\n}if(velocity.r>FLOAT_ONE_MINUS_EPSILON&&velocity.g>FLOAT_ONE_MINUS_EPSILON){alpha=0.0;velocityDisocclusion=1.0;}}else{accumulatedColor=transformColor(textureLod(accumulatedTexture,vUv,0.0).rgb);}vec3 outputColor=inputColor;\n#include <custom_compose_shader>\ngl_FragColor=vec4(undoColorTransform(outputColor),alpha);}" // eslint-disable-line

class TemporalResolveMaterial extends ShaderMaterial {
	constructor(customComposeShader) {
		const fragmentShader = temporalResolve.replace("#include <custom_compose_shader>", customComposeShader)
		super({
			type: "TemporalResolveMaterial",
			uniforms: {
				inputTexture: new Uniform(null),
				accumulatedTexture: new Uniform(null),
				velocityTexture: new Uniform(null),
				lastVelocityTexture: new Uniform(null),
				samples: new Uniform(1),
				blend: new Uniform(0.5),
				correction: new Uniform(1),
				exponent: new Uniform(1),
				invTexSize: new Uniform(new Vector2())
			},
			defines: {
				maxNeighborDepthDifference: "0.001",
				correctionRadius: 1
			},
			vertexShader,
			fragmentShader
		})
	}
}

// this shader is from: https://github.com/gkjohnson/threejs-sandbox
// a second set of bone information from the previou frame

const prev_skinning_pars_vertex =
	/* glsl */
	`
		#ifdef USE_SKINNING
		#ifdef BONE_TEXTURE
			uniform sampler2D prevBoneTexture;
			mat4 getPrevBoneMatrix( const in float i ) {
				float j = i * 4.0;
				float x = mod( j, float( boneTextureSize ) );
				float y = floor( j / float( boneTextureSize ) );
				float dx = 1.0 / float( boneTextureSize );
				float dy = 1.0 / float( boneTextureSize );
				y = dy * ( y + 0.5 );
				vec4 v1 = texture2D( prevBoneTexture, vec2( dx * ( x + 0.5 ), y ) );
				vec4 v2 = texture2D( prevBoneTexture, vec2( dx * ( x + 1.5 ), y ) );
				vec4 v3 = texture2D( prevBoneTexture, vec2( dx * ( x + 2.5 ), y ) );
				vec4 v4 = texture2D( prevBoneTexture, vec2( dx * ( x + 3.5 ), y ) );
				mat4 bone = mat4( v1, v2, v3, v4 );
				return bone;
			}
		#else
			uniform mat4 prevBoneMatrices[ MAX_BONES ];
			mat4 getPrevBoneMatrix( const in float i ) {
				mat4 bone = prevBoneMatrices[ int(i) ];
				return bone;
			}
		#endif
		#endif
` // Returns the body of the vertex shader for the velocity buffer and
// outputs the position of the current and last frame positions

const velocity_vertex =
	/* glsl */
	`
		vec3 transformed;

		// Get the normal
		${ShaderChunk.skinbase_vertex}
		${ShaderChunk.beginnormal_vertex}
		${ShaderChunk.skinnormal_vertex}
		${ShaderChunk.defaultnormal_vertex}

		// Get the current vertex position
		transformed = vec3( position );
		${ShaderChunk.skinning_vertex}
		newPosition = velocityMatrix * vec4( transformed, 1.0 );

		// Get the previous vertex position
		transformed = vec3( position );
		${ShaderChunk.skinbase_vertex.replace(/mat4 /g, "").replace(/getBoneMatrix/g, "getPrevBoneMatrix")}
		${ShaderChunk.skinning_vertex.replace(/vec4 /g, "")}
		prevPosition = prevVelocityMatrix * vec4( transformed, 1.0 );

		gl_Position = newPosition;
`
class VelocityMaterial extends ShaderMaterial {
	constructor() {
		super({
			uniforms: {
				prevVelocityMatrix: {
					value: new Matrix4()
				},
				velocityMatrix: {
					value: new Matrix4()
				},
				prevBoneTexture: {
					value: null
				},
				interpolateGeometry: {
					value: 0
				},
				intensity: {
					value: 1
				},
				boneTexture: {
					value: null
				},
				alphaTest: {
					value: 0.0
				},
				map: {
					value: null
				},
				alphaMap: {
					value: null
				},
				opacity: {
					value: 1.0
				}
			},
			vertexShader:
				/* glsl */
				`
                    #define MAX_BONES 1024
                    
                    ${ShaderChunk.skinning_pars_vertex}
                    ${prev_skinning_pars_vertex}
        
                    uniform mat4 velocityMatrix;
                    uniform mat4 prevVelocityMatrix;
                    uniform float interpolateGeometry;
                    varying vec4 prevPosition;
                    varying vec4 newPosition;
					varying vec2 vHighPrecisionZW;
        
                    void main() {
        
                        ${velocity_vertex}

						vHighPrecisionZW = gl_Position.zw;
        
                    }`,
			fragmentShader:
				/* glsl */
				`
                    uniform float intensity;
                    varying vec4 prevPosition;
                    varying vec4 newPosition;
					varying vec2 vHighPrecisionZW;
        
                    void main() {
						#ifdef FULL_MOVEMENT
						gl_FragColor = vec4( 1., 1., 1. - gl_FragCoord.z, 0. );
						return;
						#endif

                        vec2 pos0 = (prevPosition.xy / prevPosition.w) * 0.5 + 0.5;
                        vec2 pos1 = (newPosition.xy / newPosition.w) * 0.5 + 0.5;
        
                        vec2 vel = pos1 - pos0;

						float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;
                        
                        gl_FragColor = vec4( vel, 1. - fragCoordZ, 0. );
        
                    }`
		})
		this.isVelocityMaterial = true
	}
}

const backgroundColor = new Color(0)
const updateProperties = ["visible", "wireframe", "side"]
class VelocityPass extends Pass {
	constructor(scene, camera) {
		let _window
		let _window2

		super("VelocityPass")
		this.cachedMaterials = new WeakMap()
		this.lastCameraTransform = {
			position: new Vector3(),
			quaternion: new Quaternion()
		}
		this.visibleMeshes = []
		this.renderedMeshesThisFrame = 0
		this.renderedMeshesLastFrame = 0
		this._scene = scene
		this._camera = camera
		this.renderTarget = new WebGLRenderTarget(
			((_window = window) == null ? void 0 : _window.innerWidth) || 1000,
			((_window2 = window) == null ? void 0 : _window2.innerHeight) || 1000,
			{
				minFilter: NearestFilter,
				magFilter: NearestFilter,
				type: HalfFloatType
			}
		)
	}

	setVelocityMaterialInScene() {
		this.renderedMeshesThisFrame = 0
		this.visibleMeshes = getVisibleChildren(this._scene)

		for (const c of this.visibleMeshes) {
			var _c$skeleton2

			const originalMaterial = c.material
			let [cachedOriginalMaterial, velocityMaterial] = this.cachedMaterials.get(c) || []

			if (originalMaterial !== cachedOriginalMaterial) {
				var _c$skeleton

				velocityMaterial = new VelocityMaterial()
				velocityMaterial.lastMatrixWorld = new Matrix4()
				c.material = velocityMaterial
				if ((_c$skeleton = c.skeleton) != null && _c$skeleton.boneTexture) this.saveBoneTexture(c)
				this.cachedMaterials.set(c, [originalMaterial, velocityMaterial])
			}

			velocityMaterial.uniforms.velocityMatrix.value.multiplyMatrices(this._camera.projectionMatrix, c.modelViewMatrix)

			if (c.userData.needsUpdatedReflections || originalMaterial.map instanceof VideoTexture) {
				if (!("FULL_MOVEMENT" in velocityMaterial.defines)) velocityMaterial.needsUpdate = true
				velocityMaterial.defines.FULL_MOVEMENT = ""
			} else {
				if ("FULL_MOVEMENT" in velocityMaterial.defines) {
					delete velocityMaterial.defines.FULL_MOVEMENT
					velocityMaterial.needsUpdate = true
				}
			}

			c.visible =
				this.cameraMovedThisFrame ||
				!c.matrixWorld.equals(velocityMaterial.lastMatrixWorld) ||
				c.skeleton ||
				"FULL_MOVEMENT" in velocityMaterial.defines
			c.material = velocityMaterial
			if (!c.visible) continue
			this.renderedMeshesThisFrame++

			for (const prop of updateProperties) velocityMaterial[prop] = originalMaterial[prop]

			if ((_c$skeleton2 = c.skeleton) != null && _c$skeleton2.boneTexture) {
				velocityMaterial.defines.USE_SKINNING = ""
				velocityMaterial.defines.BONE_TEXTURE = ""
				velocityMaterial.uniforms.boneTexture.value = c.skeleton.boneTexture
			}
		}
	}

	saveBoneTexture(object) {
		let boneTexture = object.material.uniforms.prevBoneTexture.value

		if (boneTexture && boneTexture.image.width === object.skeleton.boneTexture.width) {
			boneTexture = object.material.uniforms.prevBoneTexture.value
			boneTexture.image.data.set(object.skeleton.boneTexture.image.data)
		} else {
			let _boneTexture
			;(_boneTexture = boneTexture) == null ? void 0 : _boneTexture.dispose()
			const boneMatrices = object.skeleton.boneTexture.image.data.slice()
			const size = object.skeleton.boneTexture.image.width
			boneTexture = new DataTexture(boneMatrices, size, size, RGBAFormat, FloatType)
			object.material.uniforms.prevBoneTexture.value = boneTexture
			boneTexture.needsUpdate = true
		}
	}

	unsetVelocityMaterialInScene() {
		for (const c of this.visibleMeshes) {
			if (c.material.isVelocityMaterial) {
				var _c$skeleton3

				c.visible = true
				c.material.lastMatrixWorld.copy(c.matrixWorld)
				c.material.uniforms.prevVelocityMatrix.value.multiplyMatrices(this._camera.projectionMatrix, c.modelViewMatrix)
				if ((_c$skeleton3 = c.skeleton) != null && _c$skeleton3.boneTexture) this.saveBoneTexture(c)
				c.material = this.cachedMaterials.get(c)[0]
			}
		}
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
	}

	renderVelocity(renderer) {
		renderer.setRenderTarget(this.renderTarget)

		if (this.renderedMeshesThisFrame > 0) {
			const { background } = this._scene
			this._scene.background = backgroundColor
			renderer.render(this._scene, this._camera)
			this._scene.background = background
		} else {
			renderer.clearColor()
		}
	}

	checkCameraMoved() {
		const moveDist = this.lastCameraTransform.position.distanceToSquared(this._camera.position)
		const rotateDist = 8 * (1 - this.lastCameraTransform.quaternion.dot(this._camera.quaternion))

		if (moveDist > 0.000001 || rotateDist > 0.000001) {
			this.lastCameraTransform.position.copy(this._camera.position)
			this.lastCameraTransform.quaternion.copy(this._camera.quaternion)
			return true
		}

		return false
	}

	render(renderer) {
		this.cameraMovedThisFrame = this.checkCameraMoved()
		this.setVelocityMaterialInScene()
		if (this.renderedMeshesThisFrame > 0 || this.renderedMeshesLastFrame > 0) this.renderVelocity(renderer)
		this.unsetVelocityMaterialInScene()
		this.renderedMeshesLastFrame = this.renderedMeshesThisFrame
	}
}

const zeroVec2 = new Vector2() // the following variables can be accessed by the custom compose shader:
// "inputTexel", "accumulatedTexel", "inputColor", "accumulatedColor", "alpha", "velocityDisocclusion", "didReproject", "boxBlurredColor" (if using box blur)
// the custom compose shader will write the final color to the variable "outputColor"

class TemporalResolvePass extends Pass {
	constructor(
		scene,
		camera,
		customComposeShader,
		options = {
			renderVelocity: true,
			dilation: true,
			boxBlur: true,
			maxNeighborDepthDifference: 1,
			logTransform: false
		}
	) {
		super("TemporalResolvePass")
		this.renderVelocity = false
		this.velocityPass = null
		this.velocityResolutionScale = 1
		this.samples = 1
		this.lastCameraTransform = {
			position: new Vector3(),
			quaternion: new Quaternion()
		}
		this._scene = scene
		this._camera = camera
		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: HalfFloatType,
			depthBuffer: false
		})
		if (options.renderVelocity !== undefined) this.renderVelocity = options.renderVelocity
		this.velocityPass = new VelocityPass(scene, camera)
		this.fullscreenMaterial = new TemporalResolveMaterial(customComposeShader)
		this.fullscreenMaterial.defines.correctionRadius = options.correctionRadius || 1
		if (options.dilation) this.fullscreenMaterial.defines.dilation = ""
		if (options.boxBlur) this.fullscreenMaterial.defines.boxBlur = ""
		if (options.logTransform) this.fullscreenMaterial.defines.logTransform = ""
		if (options.maxNeighborDepthDifference !== undefined)
			this.fullscreenMaterial.defines.maxNeighborDepthDifference = options.maxNeighborDepthDifference.toFixed(5)
		let velocityResolutionScale = options.velocityResolutionScale === undefined ? 1 : options.velocityResolutionScale
		Object.defineProperty(this, "velocityResolutionScale", {
			get() {
				return velocityResolutionScale
			},

			set(value) {
				velocityResolutionScale = value
				this.setSize(this.renderTarget.width, this.renderTarget.height)
			}
		})
		this.setupFramebuffers(1, 1)
	}

	dispose() {
		if (this._scene.userData.velocityTexture === this.velocityPass.renderTarget.texture) {
			delete this._scene.userData.velocityTexture
			delete this._scene.userData.lastVelocityTexture
		}

		this.renderTarget.dispose()
		this.accumulatedTexture.dispose()
		this.fullscreenMaterial.dispose()
		this.velocityPass.dispose()
	}

	setSize(width, height) {
		this.renderTarget.setSize(width, height)
		this.velocityPass.setSize(width * this.velocityResolutionScale, height * this.velocityResolutionScale)
		this.velocityPass.renderTarget.texture.needsUpdate = true
		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)
		this.setupFramebuffers(width, height)
	}

	setupFramebuffers(width, height) {
		if (this.accumulatedTexture) this.accumulatedTexture.dispose()
		if (this.lastVelocityTexture) this.lastVelocityTexture.dispose()
		this.accumulatedTexture = new FramebufferTexture(width, height, RGBAFormat)
		this.accumulatedTexture.minFilter = LinearFilter
		this.accumulatedTexture.magFilter = LinearFilter
		this.accumulatedTexture.type = HalfFloatType
		this.lastVelocityTexture = new FramebufferTexture(
			width * this.velocityResolutionScale,
			height * this.velocityResolutionScale,
			RGBAFormat
		)
		this.lastVelocityTexture.minFilter = NearestFilter
		this.lastVelocityTexture.magFilter = NearestFilter
		this.lastVelocityTexture.type = HalfFloatType
		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.accumulatedTexture
		this.fullscreenMaterial.uniforms.lastVelocityTexture.value = this.lastVelocityTexture
		this.fullscreenMaterial.needsUpdate = true
	}

	checkCanUseSharedVelocityTexture() {
		const now = performance.now()
		const canUseSharedVelocityTexture =
			this._scene.userData.velocityTexture &&
			this.velocityPass.renderTarget.texture !== this._scene.userData.velocityTexture

		if (canUseSharedVelocityTexture && now - this._scene.userData.lastVelocityTextureTime < 1000) {
			// let's use the shared one instead
			if (this.velocityPass.renderTarget.texture !== this.fullscreenMaterial.uniforms.velocityTexture.value) {
				this.fullscreenMaterial.uniforms.lastVelocityTexture.value = this._scene.userData.lastVelocityTexture
				this.fullscreenMaterial.uniforms.velocityTexture.value = this._scene.userData.velocityTexture
				this.fullscreenMaterial.needsUpdate = true
			}
		} else {
			// let's stop using the shared one (if used) and mark ours as the shared one instead
			if (this.velocityPass.renderTarget.texture !== this.fullscreenMaterial.uniforms.velocityTexture.value) {
				this.fullscreenMaterial.uniforms.velocityTexture.value = this.velocityPass.renderTarget.texture
				this.fullscreenMaterial.uniforms.lastVelocityTexture.value = this.lastVelocityTexture
				this.fullscreenMaterial.needsUpdate = true

				if (!this._scene.userData.velocityTexture) {
					this._scene.userData.velocityTexture = this.velocityPass.renderTarget.texture
					this._scene.userData.lastVelocityTextureTime = now
				}
			}
		}

		return this.velocityPass.renderTarget.texture !== this.fullscreenMaterial.uniforms.velocityTexture.value
	}

	checkNeedsResample() {
		const moveDist = this.lastCameraTransform.position.distanceToSquared(this._camera.position)
		const rotateDist = 8 * (1 - this.lastCameraTransform.quaternion.dot(this._camera.quaternion))

		if (moveDist > 0.000001 || rotateDist > 0.000001) {
			this.samples = 1
			this.lastCameraTransform.position.copy(this._camera.position)
			this.lastCameraTransform.quaternion.copy(this._camera.quaternion)
		}
	}

	render(renderer) {
		this.samples++
		this.checkNeedsResample()
		this.fullscreenMaterial.uniforms.samples.value = this.samples
		const isUsingSharedVelocityTexture = this.checkCanUseSharedVelocityTexture()

		if (!isUsingSharedVelocityTexture && this.renderVelocity) {
			this.velocityPass.render(renderer)
		}

		if (this._scene.userData.velocityTexture === this.fullscreenMaterial.uniforms.velocityTexture.value) {
			const now = performance.now()
			this._scene.userData.lastVelocityTextureTime = now
		}

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera) // save the render target's texture for use in next frame

		renderer.copyFramebufferToTexture(zeroVec2, this.accumulatedTexture)
		renderer.setRenderTarget(this.velocityPass.renderTarget)
		renderer.copyFramebufferToTexture(zeroVec2, this.lastVelocityTexture)
	}
}

// source: https://observablehq.com/@jrus/halton
const halton = function halton(index, base) {
	let fraction = 1
	let result = 0

	while (index > 0) {
		fraction /= base
		result += fraction * (index % base)
		index = ~~(index / base) // floor division
	}

	return result
} // generates Halton tuples in the range [-0.5:0.5]

const generateHalton23Points = count => {
	const data = []
	let i = 1
	const end = i + count

	for (; i < end; i++) {
		data.push([halton(i, 2) - 0.5, halton(i, 3) - 0.5])
	}

	return data
}

/* eslint-disable camelcase */

function escapeRegExp(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // $& means the whole matched string
} // credits for the box-projecting shader code go to codercat (https://codercat.tk)

const worldposReplace =
	/* glsl */
	`
#if defined( USE_ENVMAP ) || defined(  ) || defined ( USE_SHADOWMAP )
    vec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );

    #ifdef BOX_PROJECTED_ENV_MAP
        vWorldPosition = worldPosition.xyz;
    #endif
#endif
`
const boxProjectDefinitions =
	/* glsl */
	`
#ifdef BOX_PROJECTED_ENV_MAP
    uniform vec3 envMapSize;
    uniform vec3 envMapPosition;
    varying vec3 vWorldPosition;
    
    vec3 parallaxCorrectNormal( vec3 v, vec3 cubeSize, vec3 cubePos ) {
        vec3 nDir = normalize( v );

        vec3 rbmax = ( .5 * cubeSize + cubePos - vWorldPosition ) / nDir;
        vec3 rbmin = ( -.5 * cubeSize + cubePos - vWorldPosition ) / nDir;

        vec3 rbminmax;

        rbminmax.x = ( nDir.x > 0. ) ? rbmax.x : rbmin.x;
        rbminmax.y = ( nDir.y > 0. ) ? rbmax.y : rbmin.y;
        rbminmax.z = ( nDir.z > 0. ) ? rbmax.z : rbmin.z;

        float correction = min( min( rbminmax.x, rbminmax.y ), rbminmax.z );
        vec3 boxIntersection = vWorldPosition + nDir * correction;
        
        return boxIntersection - cubePos;
    }
#endif
` // will be inserted after "vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );"

const getIBLIrradiance_patch =
	/* glsl */
	`
#ifdef BOX_PROJECTED_ENV_MAP
    worldNormal = parallaxCorrectNormal( worldNormal, envMapSize, envMapPosition );
#endif
` // will be inserted after "reflectVec = inverseTransformDirection( reflectVec, viewMatrix );"

const getIBLRadiance_patch =
	/* glsl */
	`
#ifdef BOX_PROJECTED_ENV_MAP
    reflectVec = parallaxCorrectNormal( reflectVec, envMapSize, envMapPosition );
#endif
`
function useBoxProjectedEnvMap(shader, envMapPosition, envMapSize) {
	// defines
	shader.defines.BOX_PROJECTED_ENV_MAP = "" // uniforms

	shader.uniforms.envMapPosition = {
		value: envMapPosition
	}
	shader.uniforms.envMapSize = {
		value: envMapSize
	}
	const line1 = new RegExp(
		escapeRegExp("vec3 worldNormal = inverseTransformDirection ( normal , viewMatrix ) ;").replaceAll(" ", "\\s*"),
		"g"
	)
	const line2 = new RegExp(
		escapeRegExp("reflectVec = inverseTransformDirection ( reflectVec , viewMatrix ) ;").replaceAll(" ", "\\s*"),
		"g"
	) // vertex shader

	shader.vertexShader =
		"varying vec3 vWorldPosition;\n" + shader.vertexShader.replace("#include <worldpos_vertex>", worldposReplace) // fragment shader

	shader.fragmentShader =
		boxProjectDefinitions +
		"\n" +
		shader.fragmentShader
			.replace("#include <envmap_physical_pars_fragment>", ShaderChunk.envmap_physical_pars_fragment)
			.replace(
				line1,
				`vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
                ${getIBLIrradiance_patch}`
			)
			.replace(
				line2,
				`reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
                ${getIBLRadiance_patch}`
			)
}

const finalFragmentShader = finalSSRShader
	.replace("#include <helperFunctions>", helperFunctions)
	.replace("#include <boxBlur>", boxBlur) // all the properties for which we don't have to resample

const noResetSamplesProperties = ["blur", "blurSharpness", "blurKernel"]
const defaultCubeRenderTarget = new WebGLCubeRenderTarget(1)
let pmremGenerator
class SSREffect extends Effect {
	/**
	 * @param {THREE.Scene} scene The scene of the SSR effect
	 * @param {THREE.Camera} camera The camera with which SSR is being rendered
	 * @param {SSROptions} [options] The optional options for the SSR effect
	 */
	constructor(scene, camera, options = defaultSSROptions) {
		super("SSREffect", finalFragmentShader, {
			type: "FinalSSRMaterial",
			uniforms: new Map([
				["reflectionsTexture", new Uniform(null)],
				["intensity", new Uniform(1)],
				["blur", new Uniform(0)],
				["blurSharpness", new Uniform(0)],
				["blurKernel", new Uniform(0)]
			]),
			defines: new Map([["RENDER_MODE", "0"]])
		})
		this.haltonSequence = generateHalton23Points(1024)
		this.haltonIndex = 0
		this.selection = new Selection()
		this.lastSize = void 0
		this.cubeCamera = new CubeCamera(0.001, 1000, defaultCubeRenderTarget)
		this.usingBoxProjectedEnvMap = false
		this._scene = scene
		this._camera = camera
		const trOptions = {
			boxBlur: true,
			dilation: true,
			renderVelocity: false
		}
		options = _extends({}, defaultSSROptions, options, trOptions) // set up passes
		// temporal resolve pass

		this.temporalResolvePass = new TemporalResolvePass(scene, camera, trCompose, options)
		this.uniforms.get("reflectionsTexture").value = this.temporalResolvePass.renderTarget.texture // reflections pass

		this.reflectionsPass = new ReflectionsPass(this, options)
		this.temporalResolvePass.fullscreenMaterial.uniforms.inputTexture.value = this.reflectionsPass.renderTarget.texture
		this.lastSize = {
			width: options.width,
			height: options.height,
			resolutionScale: options.resolutionScale,
			velocityResolutionScale: options.velocityResolutionScale
		}
		this.setSize(options.width, options.height)
		this.makeOptionsReactive(options)
	}

	makeOptionsReactive(options) {
		let needsUpdate = false
		const reflectionPassFullscreenMaterialUniforms = this.reflectionsPass.fullscreenMaterial.uniforms
		const reflectionPassFullscreenMaterialUniformsKeys = Object.keys(reflectionPassFullscreenMaterialUniforms)

		for (const key of Object.keys(options)) {
			Object.defineProperty(this, key, {
				get() {
					return options[key]
				},

				set(value) {
					if (options[key] === value && needsUpdate) return
					options[key] = value

					if (!noResetSamplesProperties.includes(key)) {
						this.setSize(this.lastSize.width, this.lastSize.height, true)
					}

					switch (key) {
						case "intensity":
							this.uniforms.get("intensity").value = value
							break

						case "resolutionScale":
							this.setSize(this.lastSize.width, this.lastSize.height)
							break

						case "velocityResolutionScale":
							this.temporalResolvePass.velocityResolutionScale = value
							this.setSize(this.lastSize.width, this.lastSize.height, true)
							break

						case "blur":
							this.uniforms.get("blur").value = value
							break

						case "blurSharpness":
							this.uniforms.get("blurSharpness").value = value
							break

						case "blurKernel":
							this.uniforms.get("blurKernel").value = value
							break
						// defines

						case "steps":
							this.reflectionsPass.fullscreenMaterial.defines.steps = parseInt(value)
							this.reflectionsPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "refineSteps":
							this.reflectionsPass.fullscreenMaterial.defines.refineSteps = parseInt(value)
							this.reflectionsPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "missedRays":
							if (value) {
								this.reflectionsPass.fullscreenMaterial.defines.missedRays = ""
							} else {
								delete this.reflectionsPass.fullscreenMaterial.defines.missedRays
							}

							this.reflectionsPass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "correctionRadius":
							this.temporalResolvePass.fullscreenMaterial.defines.correctionRadius = Math.round(value)
							this.temporalResolvePass.fullscreenMaterial.needsUpdate = needsUpdate
							break

						case "blend":
							this.temporalResolvePass.fullscreenMaterial.uniforms.blend.value = value
							break

						case "correction":
							this.temporalResolvePass.fullscreenMaterial.uniforms.correction.value = value
							break

						case "exponent":
							this.temporalResolvePass.fullscreenMaterial.uniforms.exponent.value = value
							break

						case "distance":
							reflectionPassFullscreenMaterialUniforms.rayDistance.value = value
						// must be a uniform

						default:
							if (reflectionPassFullscreenMaterialUniformsKeys.includes(key)) {
								reflectionPassFullscreenMaterialUniforms[key].value = value
							}
					}
				}
			}) // apply all uniforms and defines

			this[key] = options[key]
		}

		needsUpdate = true
	}

	setSize(width, height, force = false) {
		if (
			!force &&
			width === this.lastSize.width &&
			height === this.lastSize.height &&
			this.resolutionScale === this.lastSize.resolutionScale &&
			this.velocityResolutionScale === this.lastSize.velocityResolutionScale
		)
			return
		this.temporalResolvePass.setSize(width, height)
		this.reflectionsPass.setSize(width, height)
		this.lastSize = {
			width,
			height,
			resolutionScale: this.resolutionScale,
			velocityResolutionScale: this.velocityResolutionScale
		}
	}

	generateBoxProjectedEnvMapFallback(renderer, position = new Vector3(), size = new Vector3(), envMapSize = 512) {
		this.cubeCamera.renderTarget.dispose()
		this.cubeCamera.renderTarget = new WebGLCubeRenderTarget(envMapSize)
		this.cubeCamera.position.copy(position)
		this.cubeCamera.updateMatrixWorld()
		this.cubeCamera.update(renderer, this._scene)

		if (!pmremGenerator) {
			pmremGenerator = new PMREMGenerator(renderer)
			pmremGenerator.compileCubemapShader()
		}

		const envMap = pmremGenerator.fromCubemap(this.cubeCamera.renderTarget.texture).texture
		envMap.minFilter = LinearFilter
		envMap.magFilter = LinearFilter
		const reflectionsMaterial = this.reflectionsPass.fullscreenMaterial
		useBoxProjectedEnvMap(reflectionsMaterial, position, size)
		reflectionsMaterial.fragmentShader = reflectionsMaterial.fragmentShader
			.replace("vec3 worldPos", "worldPos")
			.replace("varying vec3 vWorldPosition;", "vec3 worldPos;")
		reflectionsMaterial.uniforms.envMapPosition.value.copy(position)
		reflectionsMaterial.uniforms.envMapSize.value.copy(size)
		setupEnvMap(reflectionsMaterial, envMap, envMapSize)
		this.usingBoxProjectedEnvMap = true
		return envMap
	}

	setIBLRadiance(iblRadiance, renderer) {
		this._scene.traverse(c => {
			if (c.material) {
				let _renderer$properties$

				const uniforms =
					(_renderer$properties$ = renderer.properties.get(c.material)) == null
						? void 0
						: _renderer$properties$.uniforms

				if (uniforms && "disableIBLRadiance" in uniforms) {
					uniforms.disableIBLRadiance.value = iblRadiance
				}
			}
		})
	}

	deleteBoxProjectedEnvMapFallback() {
		const reflectionsMaterial = this.reflectionsPass.fullscreenMaterial
		reflectionsMaterial.uniforms.envMap.value = null
		reflectionsMaterial.fragmentShader = reflectionsMaterial.fragmentShader.replace("worldPos = ", "vec3 worldPos = ")
		delete reflectionsMaterial.defines.BOX_PROJECTED_ENV_MAP
		reflectionsMaterial.needsUpdate = true
		this.usingBoxProjectedEnvMap = false
	}

	dispose() {
		super.dispose()
		this.reflectionsPass.dispose()
		this.temporalResolvePass.dispose()
	}

	update(renderer, inputBuffer) {
		if (!this.usingBoxProjectedEnvMap && this._scene.environment) {
			const reflectionsMaterial = this.reflectionsPass.fullscreenMaterial
			let envMap = null // not sure if there is a cleaner way to find the internal texture of a CubeTexture (when used as scene environment)

			this._scene.traverse(c => {
				if (!envMap && c.material && !c.material.envMap) {
					const properties = renderer.properties.get(c.material)
					if ("envMap" in properties && properties.envMap instanceof Texture) envMap = properties.envMap
				}
			})

			if (envMap) {
				const envMapCubeUVHeight = this._scene.environment.image.height
				setupEnvMap(reflectionsMaterial, envMap, envMapCubeUVHeight)
			}
		}

		this.haltonIndex = (this.haltonIndex + 1) % this.haltonSequence.length
		const [x, y] = this.haltonSequence[this.haltonIndex]
		const { width, height } = this.lastSize
		this.temporalResolvePass.velocityPass.render(renderer) // jittering the view offset each frame reduces aliasing for the reflection

		if (this._camera.setViewOffset) this._camera.setViewOffset(width, height, x, y, width, height) // render reflections of current frame

		this.reflectionsPass.render(renderer, inputBuffer) // compose reflection of last and current frame into one reflection

		this.temporalResolvePass.render(renderer)

		this._camera.clearViewOffset()
	}

	static patchDirectEnvIntensity(envMapIntensity = 0) {
		if (envMapIntensity === 0) {
			ShaderChunk.envmap_physical_pars_fragment = ShaderChunk.envmap_physical_pars_fragment.replace(
				"vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {",
				"vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) { return vec3(0.0);"
			)
		} else {
			ShaderChunk.envmap_physical_pars_fragment = ShaderChunk.envmap_physical_pars_fragment.replace(
				"vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness );",
				"vec4 envMapColor = textureCubeUV( envMap, reflectVec, roughness ) * " + envMapIntensity.toFixed(5) + ";"
			)
		}
	}
}

export { SSREffect, defaultSSROptions }
