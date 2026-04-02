export { createOtlpExporter } from './exporter.ts'
export type { OtlpExporterOptions } from './exporter.ts'

export {
  toExportLogsServiceRequest,
  toAnyValue,
  toAttributes,
  SeverityNumber,
} from './mapping.ts'
export type {
  OtlpResource,
  OtlpLogRecord,
  OtlpAnyValue,
  OtlpKeyValue,
  ExportLogsServiceRequest,
} from './mapping.ts'
