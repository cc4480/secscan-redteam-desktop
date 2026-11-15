/** Locale bundles for the local models settings section. */

/** Locale keys the section renders. */
export type LocalModelsLocaleKey =
  | 'nav'
  | 'title'
  | 'intro'
  | 'refresh'
  | 'loading'
  | 'loadFailed'
  | 'endpointTitle'
  | 'endpointUp'
  | 'endpointDown'
  | 'endpointDownHint'
  | 'servedTitle'
  | 'servedEmpty'
  | 'loaded'
  | 'available'
  | 'contextLength'
  | 'maxContextLength'
  | 'memoryInUse'
  | 'folderTitle'
  | 'folderEmpty'
  | 'onDisk'
  | 'notServed'
  | 'start'
  | 'stop'
  | 'download'
  | 'delete'
  | 'confirmDelete'
  | 'cancel'
  | 'starting'
  | 'stopping'
  | 'deleting'
  | 'pullProgress'
  | 'pullPercent'
  | 'downloadTitle'
  | 'downloadIntro'
  | 'hfRepo'
  | 'listFiles'
  | 'listingFiles'
  | 'repoFilesTitle'
  | 'repoEmpty'
  | 'fileSizeMb'
  | 'fileSizeGb'
  | 'fileSizeUnknown'
  | 'downloadFile'
  | 'downloadFailed'
  | 'contextLabel'
  | 'contextSave'
  | 'contextClear'
  | 'contextSaving'
  | 'contextDefaultMaximum'
  | 'contextDefaultServer'

/** English copy. */
export const en: Record<LocalModelsLocaleKey, string> = {
  nav: 'Local models',
  title: 'Local models',
  intro: 'Models served by this host\'s local endpoint, and model files stored on this host.',
  refresh: 'Refresh',
  loading: 'Loading local models…',
  loadFailed: 'Local models could not be loaded.',
  endpointTitle: 'Local endpoint',
  endpointUp: 'Endpoint is up',
  endpointDown: 'Endpoint is down',
  endpointDownHint: 'The local endpoint did not answer.',
  servedTitle: 'Served models',
  servedEmpty: 'No models are available from the local endpoint.',
  loaded: 'Loaded',
  available: 'Available',
  contextLength: 'Context: {count}',
  maxContextLength: 'Maximum context: {count}',
  memoryInUse: 'Memory in use: {size} bytes',
  folderTitle: 'Model files on this host',
  folderEmpty: 'No model files in the local models folder.',
  onDisk: 'On disk',
  notServed: 'Not served',
  start: 'Start',
  stop: 'Stop',
  download: 'Download',
  delete: 'Delete',
  confirmDelete: 'Confirm delete',
  cancel: 'Cancel',
  starting: 'Starting…',
  stopping: 'Stopping…',
  deleting: 'Deleting…',
  pullProgress: 'Downloading: {status}',
  pullPercent: '{percent}%',
  downloadTitle: 'Download from Hugging Face',
  downloadIntro: 'Name a Hugging Face repository, list its GGUF files, and download the one you pick into the local models folder.',
  hfRepo: 'Hugging Face repository',
  listFiles: 'List files',
  listingFiles: 'Listing files…',
  repoFilesTitle: 'Files in {repo}',
  repoEmpty: 'That repository lists no downloadable GGUF files.',
  fileSizeMb: '{size} MB',
  fileSizeGb: '{size} GB',
  fileSizeUnknown: 'Size unknown',
  downloadFile: 'Download {file}',
  downloadFailed: 'The download failed.',
  contextLabel: 'Context window',
  contextSave: 'Save',
  contextClear: 'Use default',
  contextSaving: 'Saving…',
  contextDefaultMaximum: 'Default: model maximum',
  contextDefaultServer: 'Default: server setting',
}

/** Simplified Chinese copy. */
export const zh: Record<LocalModelsLocaleKey, string> = {
  nav: '本地模型',
  title: '本地模型',
  intro: '本机本地端点所服务的模型，以及存储在本机上的模型文件。',
  refresh: '刷新',
  loading: '正在加载本地模型…',
  loadFailed: '无法加载本地模型。',
  endpointTitle: '本地端点',
  endpointUp: '端点可用',
  endpointDown: '端点未运行',
  endpointDownHint: '本地端点没有响应。',
  servedTitle: '服务中的模型',
  servedEmpty: '本地端点没有可用的模型。',
  loaded: '已加载',
  available: '可用',
  contextLength: '上下文：{count}',
  maxContextLength: '最大上下文：{count}',
  memoryInUse: '占用内存：{size} 字节',
  folderTitle: '本机上的模型文件',
  folderEmpty: '本地模型文件夹中没有模型文件。',
  onDisk: '在磁盘上',
  notServed: '未在服务中',
  start: '启动',
  stop: '停止',
  download: '下载',
  delete: '删除',
  confirmDelete: '确认删除',
  cancel: '取消',
  starting: '正在启动…',
  stopping: '正在停止…',
  deleting: '正在删除…',
  pullProgress: '正在下载：{status}',
  pullPercent: '{percent}%',
  downloadTitle: '从 Hugging Face 下载',
  downloadIntro: '输入一个 Hugging Face 仓库，列出其 GGUF 文件，并下载你选择的那一个到本地模型文件夹。',
  hfRepo: 'Hugging Face 仓库',
  listFiles: '列出文件',
  listingFiles: '正在列出文件…',
  repoFilesTitle: '{repo} 中的文件',
  repoEmpty: '该仓库没有可下载的 GGUF 文件。',
  fileSizeMb: '{size} MB',
  fileSizeGb: '{size} GB',
  fileSizeUnknown: '大小未知',
  downloadFile: '下载 {file}',
  downloadFailed: '下载失败。',
  contextLabel: '上下文窗口',
  contextSave: '保存',
  contextClear: '使用默认值',
  contextSaving: '正在保存…',
  contextDefaultMaximum: '默认：模型最大值',
  contextDefaultServer: '默认：服务器设置',
}
