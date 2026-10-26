/// <reference types="vite/client" />
interface FileSystemFileHandle {
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<FileSystemWritableFileStream>
  queryPermission(descriptor?: {mode:'read'|'readwrite'}):Promise<PermissionState>
  requestPermission(descriptor?: {mode:'read'|'readwrite'}):Promise<PermissionState>
}
interface Window { showOpenFilePicker(options?:any):Promise<FileSystemFileHandle[]>; __FOLDMEMO_TEMPLATE__?:string }
