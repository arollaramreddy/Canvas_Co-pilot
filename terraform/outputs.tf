# ─── Terraform Outputs: Canvas Co-Pilot Infrastructure ──────────────────────────

output "resource_group_name" {
  description = "Name of the Azure resource group"
  value       = azurerm_resource_group.main.name
}

output "aks_cluster_name" {
  description = "AKS cluster name"
  value       = module.aks.cluster_name
}

output "aks_cluster_id" {
  description = "AKS cluster resource ID"
  value       = module.aks.cluster_id
}

output "acr_login_server" {
  description = "ACR login server URL (for docker push/pull)"
  value       = module.aks.acr_login_server
}

output "redis_hostname" {
  description = "Azure Cache for Redis hostname"
  value       = module.redis.hostname
  sensitive   = false
}

output "redis_primary_key" {
  description = "Azure Cache for Redis primary access key"
  value       = module.redis.primary_key
  sensitive   = true
}

output "storage_account_name" {
  description = "Storage account name for course content archive"
  value       = module.storage.account_name
}

output "storage_primary_key" {
  description = "Storage account primary access key"
  value       = module.storage.primary_key
  sensitive   = true
}

output "kube_config" {
  description = "Kubeconfig for kubectl access (sensitive)"
  value       = module.aks.kube_config_raw
  sensitive   = true
}

output "kubectl_command" {
  description = "Command to configure local kubectl"
  value       = "az aks get-credentials --resource-group ${azurerm_resource_group.main.name} --name ${module.aks.cluster_name}"
}

output "deploy_instructions" {
  description = "Post-apply deployment steps"
  value       = <<-EOT
    Next steps after terraform apply:
    1. Configure kubectl:
       az aks get-credentials --resource-group ${azurerm_resource_group.main.name} --name ${module.aks.cluster_name}
    2. Create namespace:
       kubectl apply -f ../k8s/namespace.yaml
    3. Create secrets:
       kubectl create secret generic canvas-copilot-secrets --from-env-file=../.env -n canvas-copilot
    4. Deploy application:
       kubectl apply -f ../k8s/ -n canvas-copilot
    5. Check rollout:
       kubectl rollout status deployment/canvas-copilot-app -n canvas-copilot
  EOT
}
