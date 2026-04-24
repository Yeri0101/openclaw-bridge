import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

type Language = 'en' | 'es';

type Translations = {
    [key in Language]: Record<string, string>;
};

const translations: Translations = {
    en: {
        'nav.title': 'OpenClaw Gateway',
        'nav.logout': 'Logout',
        'nav.change_password': 'Change Password',
        'settings.password_title': 'Change Password',
        'settings.current_password': 'Current Password',
        'settings.new_password': 'New Password',
        'settings.btn_update': 'Update Password',
        'settings.btn_cancel': 'Cancel',
        'settings.success': 'Password updated successfully!',
        'settings.error': 'Failed to update password.',
        'dashboard.title': 'Projects',
        'dashboard.subtitle': 'Manage your OpenClaw API gateways and agents',
        'dashboard.create_title': 'Create New Project',
        'dashboard.create_desc': 'A project groups your Upstream API keys (Groq, OpenRouter) and Gateway keys.',
        'dashboard.input_placeholder': 'e.g. Main Agency',
        'dashboard.btn_create': 'Create',
        'dashboard.no_projects': 'No projects yet',
        'dashboard.no_projects_desc': 'Create your first project above to get started.',
        'dashboard.created': 'Created:',
        'dashboard.recent_calls': 'Latest Calls',
        'dashboard.recent_calls_desc': 'The last 3 project requests processed by the gateway.',
        'dashboard.recent_project': 'Project',
        'dashboard.recent_model': 'LLM',
        'dashboard.recent_latency': 'Latency',
        'dashboard.recent_tokens': 'Tokens',
        'dashboard.recent_time': 'Time',
        'dashboard.recent_empty': 'No recent calls yet',
        'dashboard.delete_confirm': 'Are you sure you want to delete this project?',
        'dashboard.rename': 'Rename',
        'dashboard.save': 'Save',
        'project.back': 'Back to Projects',
        'project.tab_providers': 'Upstream Providers',
        'project.tab_gateway': 'Gateway Keys',
        'project.tab_analytics': 'Analytics',
        'project.add_provider': 'Add Provider Key',
        'project.provider': 'Provider',
        'project.api_key': 'API Key',
        'project.btn_save_fetch': 'Save & Fetch Models',
        'project.configured_providers': 'Configured Providers',
        'project.no_providers': 'No providers configured for this project.',
        'project.status': 'Status',
        'project.usage': 'Usage (Min / Day)',
        'project.actions': 'Actions',
        'project.create_gateway': 'Create Gateway Key',
        'project.key_name': 'Key Name (e.g. Agent Rocky)',
        'project.custom_key': 'Custom Key (Optional)',
        'project.custom_key_ph': 'Leave blank for auto-generation',
        'project.select_models': 'Select Allowed Models',
        'project.no_models': 'No models found. Add a provider first.',
        'project.btn_create_key': 'Create API Key',
        'project.active_gateways': 'Active Gateway Keys',
        'project.no_gateways': 'No gateway keys issued yet.',
        'project.allowed_models': 'Allowed Models',
        'project.test_gateway': 'Test Gateway Key',
        'project.select_model_ph': 'Select a model...',
        'project.test_prompt_ph': 'Enter test prompt... e.g. Hello, what can you do?',
        'project.btn_test': 'Send Test Request',
        'project.btn_testing': 'Testing...',
        'project.analytics.total_reqs': 'Total Requests',
        'project.analytics.success_rate': 'Success Rate',
        'project.analytics.tokens': 'Tokens Processed',
        'project.analytics.cost': 'Estimated Cost',
        'project.analytics.latency': 'Avg Latency',
        'project.analytics.budget': 'Budget',
        'project.analytics.alert_threshold': 'Alert Threshold %',
        'project.analytics.remaining': 'Remaining',
        'project.analytics.model_pricing': 'Model Pricing',
        'project.analytics.input_price': 'Input / 1M',
        'project.analytics.output_price': 'Output / 1M',
        'project.analytics.any_provider': 'Any provider',
        'project.analytics.save_budget': 'Save Budget',
        'project.analytics.add_pricing': 'Save Pricing',
        'project.analytics.warning_threshold': 'Budget warning threshold reached.',
        'project.analytics.limit_reached': 'Budget limit reached. New gateway requests are blocked.',
        'project.analytics.top_providers': 'Top Providers',
        'project.analytics.no_provider_data': 'No provider data available yet.',
        'project.analytics.top_models': 'Top Models',
        'project.analytics.no_model_data': 'No model data available yet.',
        'project.analytics.clear': 'Clear Analytics',
        'project.analytics.clear_confirm': 'Are you sure you want to delete all analytics records? This action cannot be undone.',
        'project.analytics.export': 'Export to Markdown',
        'project.analytics.recent_requests': 'Recent Requests',
        'login.title': 'Welcome Back',
        'login.subtitle': 'Sign in to OpenClaw Dashboard',
        'login.email': 'Email',
        'login.password': 'Password',
        'login.btn_signin': 'Sign In',
        'login.btn_signing_in': 'Signing In...',
        'login.error': 'Login failed',
    },
    es: {
        'nav.title': 'OpenClaw Gateway',
        'nav.logout': 'Cerrar Sesión',
        'nav.change_password': 'Cambiar Contraseña',
        'settings.password_title': 'Cambiar Contraseña',
        'settings.current_password': 'Contraseña Actual',
        'settings.new_password': 'Nueva Contraseña',
        'settings.btn_update': 'Actualizar Contraseña',
        'settings.btn_cancel': 'Cancelar',
        'settings.success': '¡Contraseña actualizada con éxito!',
        'settings.error': 'Error al actualizar la contraseña.',
        'dashboard.title': 'Proyectos',
        'dashboard.subtitle': 'Gestiona tus API gateways y agentes de OpenClaw',
        'dashboard.create_title': 'Crear Nuevo Proyecto',
        'dashboard.create_desc': 'Un proyecto agrupa tus claves de API "Upstream" (Groq, OpenRouter) y claves Gateway.',
        'dashboard.input_placeholder': 'ej. Agencia Principal',
        'dashboard.btn_create': 'Crear',
        'dashboard.no_projects': 'No hay proyectos aún',
        'dashboard.no_projects_desc': 'Crea tu primer proyecto arriba para empezar.',
        'dashboard.created': 'Creado:',
        'dashboard.recent_calls': 'Ultimas Llamadas',
        'dashboard.recent_calls_desc': 'Las ultimas 3 solicitudes de proyecto procesadas por el gateway.',
        'dashboard.recent_project': 'Proyecto',
        'dashboard.recent_model': 'LLM',
        'dashboard.recent_latency': 'Latencia',
        'dashboard.recent_tokens': 'Tokens',
        'dashboard.recent_time': 'Hora',
        'dashboard.recent_empty': 'Aun no hay llamadas recientes',
        'dashboard.delete_confirm': '¿Estás seguro que deseas eliminar este proyecto?',
        'dashboard.rename': 'Renombrar',
        'dashboard.save': 'Guardar',
        'project.back': 'Volver a Proyectos',
        'project.tab_providers': 'Proveedores Upstream',
        'project.tab_gateway': 'Claves Gateway',
        'project.tab_analytics': 'Analíticas',
        'project.add_provider': 'Agregar Clave de Proveedor',
        'project.provider': 'Proveedor',
        'project.api_key': 'Clave API',
        'project.btn_save_fetch': 'Guardar y Obtener Modelos',
        'project.configured_providers': 'Proveedores Configurados',
        'project.no_providers': 'No hay proveedores configurados en este proyecto.',
        'project.status': 'Estado',
        'project.usage': 'Uso (Min / Día)',
        'project.actions': 'Acciones',
        'project.create_gateway': 'Crear Clave Gateway',
        'project.key_name': 'Nombre de Clave (ej. Agente Rocky)',
        'project.custom_key': 'Clave Personalizada (Opcional)',
        'project.custom_key_ph': 'Dejar en blanco para auto-generar',
        'project.select_models': 'Seleccionar Modelos Permitidos',
        'project.no_models': 'No se encontraron modelos. Añade un proveedor primero.',
        'project.btn_create_key': 'Crear Clave API',
        'project.active_gateways': 'Claves Gateway Activas',
        'project.no_gateways': 'No hay claves gateway emitidas aún.',
        'project.allowed_models': 'Modelos Permitidos',
        'project.test_gateway': 'Probar Clave Gateway',
        'project.select_model_ph': 'Selecciona un modelo...',
        'project.test_prompt_ph': 'Ingresa un prompt de prueba... ej. Hola, ¿qué puedes hacer?',
        'project.btn_test': 'Enviar Petición de Prueba',
        'project.btn_testing': 'Probando...',
        'project.analytics.total_reqs': 'Total Peticiones',
        'project.analytics.success_rate': 'Tasa Éxito',
        'project.analytics.tokens': 'Tokens Procesados',
        'project.analytics.cost': 'Costo Estimado',
        'project.analytics.latency': 'Latencia Promedio',
        'project.analytics.budget': 'Presupuesto',
        'project.analytics.alert_threshold': 'Umbral de Alerta %',
        'project.analytics.remaining': 'Restante',
        'project.analytics.model_pricing': 'Precios por Modelo',
        'project.analytics.input_price': 'Input / 1M',
        'project.analytics.output_price': 'Output / 1M',
        'project.analytics.any_provider': 'Cualquier proveedor',
        'project.analytics.save_budget': 'Guardar Presupuesto',
        'project.analytics.add_pricing': 'Guardar Precio',
        'project.analytics.warning_threshold': 'Se alcanzó el umbral de advertencia del presupuesto.',
        'project.analytics.limit_reached': 'Se alcanzó el límite del presupuesto. Las nuevas requests del gateway están bloqueadas.',
        'project.analytics.top_providers': 'Mejores Proveedores',
        'project.analytics.no_provider_data': 'No hay datos de proveedores aún.',
        'project.analytics.top_models': 'Mejores Modelos',
        'project.analytics.no_model_data': 'No hay datos de modelos aún.',
        'project.analytics.clear': 'Limpiar Analíticas',
        'project.analytics.clear_confirm': '¿Estás seguro de que deseas eliminar todos los registros de análisis? Esta acción no se puede deshacer.',
        'project.analytics.export': 'Exportar a Markdown',
        'project.analytics.recent_requests': 'Peticiones Recientes',
        'login.title': 'Bienvenido',
        'login.subtitle': 'Inicia sesión en OpenClaw',
        'login.email': 'Correo Electrónico',
        'login.password': 'Contraseña',
        'login.btn_signin': 'Iniciar Sesión',
        'login.btn_signing_in': 'Iniciando...',
        'login.error': 'Error de inicio',
    }
};

interface LanguageContextType {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
    const [language, setLanguage] = useState<Language>(() => {
        return (localStorage.getItem('appLang') as Language) || 'en';
    });

    const handleSetLanguage = (lang: Language) => {
        setLanguage(lang);
        localStorage.setItem('appLang', lang);
    };

    const t = (key: string): string => {
        return translations[language][key] || key;
    };

    return (
        <LanguageContext.Provider value={{ language, setLanguage: handleSetLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

export const useLanguage = () => {
    const context = useContext(LanguageContext);
    if (context === undefined) {
        throw new Error('useLanguage must be used within a LanguageProvider');
    }
    return context;
};
