import * as THREE from './three.module.js';
export function mergeGeometry(list){
 const count=list.reduce((sum,g)=>sum+g.attributes.position.count,0),position=new Float32Array(count*3),normal=new Float32Array(count*3),uv=new Float32Array(count*2);let vertex=0;
 for(const g of list){const n=g.attributes.position.count;position.set(g.attributes.position.array,vertex*3);if(g.attributes.normal)normal.set(g.attributes.normal.array,vertex*3);if(g.attributes.uv)uv.set(g.attributes.uv.array,vertex*2);vertex+=n}
 const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.BufferAttribute(position,3));result.setAttribute('normal',new THREE.BufferAttribute(normal,3));result.setAttribute('uv',new THREE.BufferAttribute(uv,2));result.computeBoundingSphere();return result;
}
export function batchStatic(root,excluded=null){
 root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),batches=new Map(),all=[],original=[];
 const visit=node=>{if(node===excluded)return;if(node.isMesh&&!node.isInstancedMesh&&!Array.isArray(node.material)){
  const key=node.material.uuid;
  const g=(node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone()).applyMatrix4(inverse.clone().multiply(node.matrixWorld));
  if(!batches.has(key))batches.set(key,{material:node.material,geometry:[]});batches.get(key).geometry.push(g);all.push(g);original.push(node);
 }for(const child of node.children)visit(child)};visit(root);
 for(const node of original){node.removeFromParent();node.geometry.dispose()}
 for(const item of batches.values()){const mesh=new THREE.Mesh(mergeGeometry(item.geometry),item.material);mesh.matrixAutoUpdate=false;root.add(mesh)}
 const shadow=all.length?mergeGeometry(all):null;for(const g of all)g.dispose();return shadow;
}
