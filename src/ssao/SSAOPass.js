import { AOPass } from "../ao/AOPass"
import fragmentShader from "./shader/ssao.frag"

class SSAOPass extends AOPass {
	constructor(camera, scene) {
		super(camera, scene, fragmentShader)
	}
}

export { SSAOPass }
