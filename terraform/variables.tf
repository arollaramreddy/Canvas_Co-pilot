# ─── Terraform Variables: Canvas Co-Pilot Azure Infrastructure ──────────────────

variable "prefix" {
  description = "Short prefix used for all resource names"
  type        = string
  default     = "copilot"
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "East US 2"
}

variable "resource_group_name" {
  description = "Name of the Azure resource group"
  type        = string
  default     = "canvas-copilot-rg"
}

variable "cluster_name" {
  description = "AKS cluster name"
  type        = string
  default     = "canvas-copilot-aks"
}

variable "kubernetes_version" {
  description = "Kubernetes version for AKS"
  type        = string
  default     = "1.29.2"
}

variable "node_count" {
  description = "Initial number of nodes in the default node pool"
  type        = number
  default     = 3
}

variable "min_node_count" {
  description = "Minimum node count for autoscaler"
  type        = number
  default     = 2
}

variable "max_node_count" {
  description = "Maximum node count for autoscaler"
  type        = number
  default     = 6
}

variable "vm_size" {
  description = "VM SKU for AKS node pool"
  type        = string
  default     = "Standard_D4s_v3"
}

variable "redis_capacity" {
  description = "Redis cache capacity (1=1GB, 2=6GB, 3=13GB)"
  type        = number
  default     = 1
}

variable "redis_family" {
  description = "Redis cache family (C=Basic/Standard, P=Premium)"
  type        = string
  default     = "C"
}

variable "redis_sku" {
  description = "Redis cache SKU (Basic, Standard, Premium)"
  type        = string
  default     = "Standard"
}

variable "acr_sku" {
  description = "Azure Container Registry SKU"
  type        = string
  default     = "Standard"
  validation {
    condition     = contains(["Basic", "Standard", "Premium"], var.acr_sku)
    error_message = "ACR SKU must be Basic, Standard, or Premium."
  }
}

variable "tags" {
  description = "Tags applied to all resources"
  type        = map(string)
  default = {
    project     = "canvas-copilot"
    environment = "production"
    team        = "ai-engineering"
    managed_by  = "terraform"
  }
}
