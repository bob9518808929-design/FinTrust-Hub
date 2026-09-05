{{/* vim: set filetype=mustache: */}}
{{/*
FinTrust Hub Helm Chart 命名模板 (INFRA-01, R4.1)

提供:
  - fintrust-hub.fullname: Chart release + 资源名后缀, 保证同一命名空间多次安装不冲突
  - fintrust-hub.name:     Chart name (默认 fintrust-hub)
  - fintrust-hub.chart:    Chart 名 + 版本
  - fintrust-hub.labels:   通用 labels (app.kubernetes.io/* 标准 8 字段)
  - fintrust-hub.selectorLabels: 资源选择器 labels (用于 Deployment selector 匹配)
  - fintrust-hub.namespace: 命名空间
  - fintrust-hub.serviceName:  Service 完整名
  - fintrust-hub.image:     镜像完整地址 (含 tag)
*/}}

{{- define "fintrust-hub.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "fintrust-hub.fullname" -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if .Values.fullnameOverride -}}
{{- $name = .Values.fullnameOverride -}}
{{- end -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "fintrust-hub.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
通用 labels (符合 Kubernetes 推荐 8 字段标签)
https://kubernetes.io/docs/concepts/overview/working-with-objects/common-labels/
*/}}
{{- define "fintrust-hub.labels" -}}
helm.sh/chart: {{ include "fintrust-hub.chart" . }}
app.kubernetes.io/name: {{ include "fintrust-hub.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: fintrust-hub
app.kubernetes.io/component: {{ .component | default "unknown" }}
{{- end -}}

{{/*
选择器 labels (与 Deployment.spec.selector.matchLabels 严格对应, 不可改字段名)
*/}}
{{- define "fintrust-hub.selectorLabels" -}}
app.kubernetes.io/name: {{ include "fintrust-hub.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "fintrust-hub.namespace" -}}
{{- default .Release.Namespace .Values.namespace | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
镜像完整地址: registry/repository:tag
若 .Values.global.imageRegistry 非空, 拼为 <registry>/<repo>:<tag>
*/}}
{{- define "fintrust-hub.image" -}}
{{- $repo := .image.repository -}}
{{- $tag := .image.tag | default .tag -}}
{{- $pullPolicy := .image.pullPolicy | default "IfNotPresent" -}}
{{- with .context.Values.global.imageRegistry -}}
image: "{{ . }}/{{ $repo }}:{{ $tag }}"
{{- else -}}
image: "{{ $repo }}:{{ $tag }}"
{{- end -}}
imagePullPolicy: {{ $pullPolicy }}
{{- end -}}

{{/*
Service 名称 (component 指定 backend/frontend/ai-engine/postgres/redis)
*/}}
{{- define "fintrust-hub.serviceName" -}}
{{- printf "%s-%s" (include "fintrust-hub.fullname" .) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}
