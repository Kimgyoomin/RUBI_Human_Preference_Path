import * as T from 'three';

/** MuJoCo has separate vertex and normal corner indices. Equal buffer lengths
 * alone do NOT prove that a normal belongs to the vertex at the same index.
 */
export function meshGeometry(model: any, meshId: number): T.BufferGeometry {
  const va = model.mesh_vertadr[meshId], vn = model.mesh_vertnum[meshId];
  const fa = model.mesh_faceadr[meshId], fn = model.mesh_facenum[meshId];
  const vertices = model.mesh_vert.subarray(3 * va, 3 * (va + vn));
  const faces = model.mesh_face.subarray(3 * fa, 3 * (fa + fn));
  const na = model.mesh_normaladr?.[meshId], nn = model.mesh_normalnum?.[meshId];
  const normalFaces = model.mesh_facenormal?.subarray(3 * fa, 3 * (fa + fn));
  const normals = Number.isInteger(na) && nn > 0 ? model.mesh_normal.subarray(3 * na, 3 * (na + nn)) : undefined;
  const geometry = new T.BufferGeometry();
  const valid = normals && normalFaces?.length === faces.length && Array.from(normalFaces as ArrayLike<number>).every(i => i >= 0 && i < nn);
  if (valid) {
    let aligned = nn >= vn;
    for (let i = 0; aligned && i < faces.length; i++) if (faces[i] !== normalFaces[i]) aligned = false;
    if (aligned) {
      geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(vertices), 3));
      geometry.setAttribute('normal', new T.BufferAttribute(new Float32Array(normals.subarray(0, vn * 3)), 3));
      geometry.setIndex(new T.BufferAttribute(new Uint32Array(faces), 1));
    } else {
      // Preserve sharp edges by expanding only when corner normals differ.
      const positions = new Float32Array(faces.length * 3), expandedNormals = new Float32Array(faces.length * 3);
      for (let i = 0; i < faces.length; i++) for (let axis = 0; axis < 3; axis++) {
        positions[3 * i + axis] = vertices[3 * faces[i] + axis];
        expandedNormals[3 * i + axis] = normals[3 * normalFaces[i] + axis];
      }
      geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new T.BufferAttribute(expandedNormals, 3));
    }
    geometry.userData.normalSource = 'mujoco';
  } else {
    geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(vertices), 3));
    geometry.setIndex(new T.BufferAttribute(new Uint32Array(faces), 1));
    geometry.computeVertexNormals();
    geometry.userData.normalSource = 'fallback';
  }
  return geometry;
}
