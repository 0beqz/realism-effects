import { DepthPass, Pass, RenderPass } from "postprocessing"
import {
	HalfFloatType,
	LinearFilter,
	LinearMipMapNearestFilter,
	MeshBasicMaterial,
	NearestFilter,
	sRGBEncoding,
	WebGLMultipleRenderTargets,
	WebGLRenderTarget
} from "three"
import { MRTMaterial } from "../material/MRTMaterial.js"
import { SSGIMaterial } from "../material/SSGIMaterial.js"
import { getVisibleChildren, isWebGL2Available } from "../utils/Utils.js"

export class SSGIPass extends Pass {
	ssgiEffect
	cachedMaterials = new WeakMap()
	isWebGL2 = false
	webgl1DepthPass = null
	visibleMeshes = []

	constructor(ssgiEffect) {
		super("SSGIPass")

		this.ssgiEffect = ssgiEffect
		this._scene = ssgiEffect._scene
		this._camera = ssgiEffect._camera

		this.useDiffuse = true

		this.fullscreenMaterial = new SSGIMaterial()
		if (ssgiEffect._camera.isPerspectiveCamera) this.fullscreenMaterial.defines.PERSPECTIVE_CAMERA = ""

		this.renderTarget = new WebGLRenderTarget(1, 1, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			type: HalfFloatType,
			depthBuffer: false
		})

		this.renderPass = new RenderPass(this._scene, this._camera)

		this.isWebGL2 = isWebGL2Available()

		// set up basic uniforms that we don't have to update
		this.fullscreenMaterial.uniforms.cameraMatrixWorld.value = this._camera.matrixWorld
		this.fullscreenMaterial.uniforms._projectionMatrix.value = this._camera.projectionMatrix
		this.fullscreenMaterial.uniforms._inverseProjectionMatrix.value = this._camera.projectionMatrixInverse
	}

	initMRTRenderTarget() {
		if (this.gBuffersRenderTarget) this.gBuffersRenderTarget.dispose()
		if (this.diffuseRenderTarget) this.diffuseRenderTarget.dispose()
		if (this.webgl1DepthPass) this.webgl1DepthPass.dispose()

		if (this.isWebGL2) {
			// buffers: normal, depth (2), roughness will be written to the alpha channel of the normal buffer
			this.gBuffersRenderTarget = new WebGLMultipleRenderTargets(1, 1, 2, {
				minFilter: NearestFilter,
				magFilter: NearestFilter
			})
		} else {
			// depth pass
			this.webgl1DepthPass = new DepthPass(this._scene, this._camera)

			// render normals (in the rgb channel) and roughness (in the alpha channel) in gBuffersRenderTarget
			this.gBuffersRenderTarget = new WebGLRenderTarget(1, 1, {
				minFilter: NearestFilter,
				magFilter: NearestFilter
			})

			this.normalTexture = this.gBuffersRenderTarget.texture
			this.depthTexture = this.webgl1DepthPass.texture
		}

		this.normalTexture = this.gBuffersRenderTarget.texture[0]
		this.depthTexture = this.gBuffersRenderTarget.texture[1]

		this.fullscreenMaterial.uniforms.normalTexture.value = this.normalTexture
		this.fullscreenMaterial.uniforms.depthTexture.value = this.depthTexture

		// diffuse texture

		if (this.useDiffuse) {
			this.diffuseRenderTarget = new WebGLRenderTarget(1, 1, {
				minFilter: LinearMipMapNearestFilter,
				magFilter: LinearMipMapNearestFilter,
				encoding: sRGBEncoding,
				generateMipmaps: true
			})

			this.diffuseTexture = this.diffuseRenderTarget.texture

			// set up uniforms

			this.fullscreenMaterial.uniforms.diffuseTexture.value = this.diffuseTexture
		}
	}

	canUseMRTDiffuseTexture() {
		return false // this.isWebGL2 && this.ssgiEffect.qualityScale === 1
	}

	setSize(width, height) {
		this.initMRTRenderTarget()

		this.renderTarget.setSize(width * this.ssgiEffect.resolutionScale, height * this.ssgiEffect.resolutionScale)
		this.gBuffersRenderTarget.setSize(width * this.ssgiEffect.qualityScale, height * this.ssgiEffect.qualityScale)
		this.diffuseRenderTarget.setSize(width, height)
		if (this.webgl1DepthPass)
			this.webgl1DepthPass.setSize(width * this.ssgiEffect.qualityScale, height * this.ssgiEffect.qualityScale)

		this.fullscreenMaterial.uniforms.invTexSize.value.set(1 / width, 1 / height)

		this.fullscreenMaterial.uniforms.accumulatedTexture.value = this.ssgiEffect.temporalResolvePass.renderTarget.texture

		this.fullscreenMaterial.needsUpdate = true
	}

	dispose() {
		this.renderTarget.dispose()
		this.gBuffersRenderTarget.dispose()
		this.renderPass.dispose()
		if (!this.isWebGL2) this.webgl1DepthPass.dispose()

		this.fullscreenMaterial.dispose()

		this.normalTexture = null
		this.depthTexture = null
		this.velocityTexture = null
	}

	keepMaterialMapUpdated(mrtMaterial, originalMaterial, prop, define, useKey) {
		if (this.ssgiEffect[useKey]) {
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
			c.visible = c.material.visible && c.material.colorWrite

			const originalMaterial = c.material

			let [cachedOriginalMaterial, mrtMaterial, diffuseMaterial] = this.cachedMaterials.get(c) || []

			if (originalMaterial !== cachedOriginalMaterial) {
				if (mrtMaterial) mrtMaterial.dispose()

				mrtMaterial = new MRTMaterial()

				if (this.isWebGL2) mrtMaterial.defines.isWebGL2 = ""
				if (this.useDiffuse) mrtMaterial.defines.useDiffuse = ""

				mrtMaterial.normalScale = originalMaterial.normalScale
				mrtMaterial.uniforms.normalScale.value = originalMaterial.normalScale

				const map =
					originalMaterial.map ||
					originalMaterial.normalMap ||
					originalMaterial.roughnessMap ||
					originalMaterial.metalnessMap

				if (map) mrtMaterial.uniforms.uvTransform.value = map.matrix

				diffuseMaterial = new MeshBasicMaterial({
					toneMapped: false
				})

				this.cachedMaterials.set(c, [originalMaterial, mrtMaterial, diffuseMaterial])
			}

			// update the child's MRT material
			this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "normalMap", "USE_NORMAL_MAP", "useNormalMap")
			this.keepMaterialMapUpdated(mrtMaterial, originalMaterial, "roughnessMap", "USE_ROUGHNESS_MAP", "useRoughnessMap")

			if (originalMaterial.map) diffuseMaterial.map = originalMaterial.map
			if (originalMaterial.color) diffuseMaterial.color = originalMaterial.color
			diffuseMaterial.visible = originalMaterial.visible

			mrtMaterial.uniforms.roughness.value =
				this.ssgiEffect.selection.size === 0 || this.ssgiEffect.selection.has(c)
					? originalMaterial.roughness || 0
					: 10e10

			c.material = mrtMaterial
		}
	}

	unsetMRTMaterialInScene() {
		for (const c of this.visibleMeshes) {
			// set material back to the original one
			const [originalMaterial] = this.cachedMaterials.get(c)

			c.visible = true

			c.material = originalMaterial
		}
	}

	setDiffuseMaterialInScene() {
		for (const c of this.visibleMeshes) {
			c.visible = c.material.visible && c.material.colorWrite

			c.material = this.cachedMaterials.get(c)[2]
		}
	}

	unsetDiffuseMaterialInScene() {
		for (const c of this.visibleMeshes) {
			// set material back to the original one
			const [originalMaterial] = this.cachedMaterials.get(c)

			c.visible = true

			c.material = originalMaterial
		}
	}

	render(renderer, inputBuffer) {
		this.setMRTMaterialInScene()

		this.renderPass.render(renderer, this.gBuffersRenderTarget)

		this.unsetMRTMaterialInScene()

		this.setDiffuseMaterialInScene()

		this.renderPass.render(renderer, this.diffuseRenderTarget)

		this.unsetDiffuseMaterialInScene()

		// render depth and velocity in seperate passes
		if (!this.isWebGL2) this.webgl1DepthPass.renderPass.render(renderer, this.webgl1DepthPass.renderTarget)

		this.fullscreenMaterial.uniforms.inputTexture.value = inputBuffer.texture
		this.fullscreenMaterial.uniforms.samples.value = this.ssgiEffect.temporalResolvePass.samples
		this.fullscreenMaterial.uniforms.cameraNear.value = this._camera.near
		this.fullscreenMaterial.uniforms.cameraFar.value = this._camera.far

		this.fullscreenMaterial.uniforms.viewMatrix.value.copy(this._camera.matrixWorldInverse)

		renderer.setRenderTarget(this.renderTarget)
		renderer.render(this.scene, this.camera)
	}
}
